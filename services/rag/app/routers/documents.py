"""Document management endpoints for Tale RAG service."""

import json
import os
from typing import Any, Dict, Optional
from uuid import uuid4

from fastapi import APIRouter, HTTPException, status, UploadFile, File, Form
from fastapi.background import BackgroundTasks
from loguru import logger

from ..config import settings
from ..models import (
    DocumentAddRequest,
    DocumentAddResponse,
    DocumentDeleteRequest,
    DocumentDeleteResponse,
    BatchAddRequest,
    BatchAddResponse,
)
from ..services.cognee import cognee_service
from ..services import job_store
from ..utils import cleanup_memory

router = APIRouter(prefix="/api/v1", tags=["Documents"])


async def _persist_text_content(content: str) -> str:
    """Persist text content to a file for cognee."""
    ingest_dir = os.path.join(settings.cognee_data_dir, "ingest")
    os.makedirs(ingest_dir, exist_ok=True)

    file_path = os.path.join(ingest_dir, f"text_{uuid4().hex}.txt")
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(content)

    logger.info(f"Text content persisted: {file_path} ({os.path.getsize(file_path)} bytes)")
    return file_path


async def _ingest_single_document(
    content: str,
    metadata: Optional[Dict[str, Any]],
    document_id: Optional[str],
) -> DocumentAddResponse:
    """Ingest a single text document."""
    # Persist text content to file so cognee can operate on a path
    file_path = await _persist_text_content(content)

    # Add to cognee
    result = await cognee_service.add_document(
        content=file_path,
        metadata=metadata,
        document_id=document_id,
    )

    return DocumentAddResponse(
        success=result.get("success", True),
        document_id=result.get("document_id", document_id or "unknown"),
        chunks_created=result.get("chunks_created", 0),
        message="Document added successfully",
    )


@router.post("/documents", response_model=DocumentAddResponse)
async def add_document(request: DocumentAddRequest, background_tasks: BackgroundTasks):
    """Add a text document to the knowledge base.

    This endpoint is intentionally simple and only accepts plain text content.
    Heavy ingestion work is delegated to a background task so callers
    (including Convex workflows) don't block on cognee processing.
    """
    # Determine a stable document_id/job_id up front
    doc_id = request.document_id or f"doc-{uuid4().hex}"

    # Create an initial queued job record so callers can immediately query status.
    job_store.create_queued(job_id=doc_id, document_id=doc_id)

    async def _background_ingest_text(
        content: str,
        metadata: Optional[Dict[str, Any]],
        document_id: str,
    ) -> None:
        try:
            job_store.mark_running(job_id=document_id)
            response = await _ingest_single_document(
                content=content,
                metadata=metadata,
                document_id=document_id,
            )
            job_store.mark_completed(
                job_id=document_id,
                document_id=response.document_id,
                chunks_created=response.chunks_created,
            )
        except Exception as exc:  # pragma: no cover - best-effort logging
            job_store.mark_failed(job_id=document_id, error=str(exc))
            logger.error(
                "Background text ingestion failed",
                extra={"document_id": document_id, "error": str(exc)},
            )
        finally:
            # Run memory cleanup after each background ingestion task
            cleanup_memory(context=f"after background text ingestion for {document_id}")

    background_tasks.add_task(
        _background_ingest_text,
        request.content,
        request.metadata,
        doc_id,
    )

    # Return immediately with queued status so upstream callers (e.g. Convex
    # workflows) don't block on heavy ingestion work.
    return DocumentAddResponse(
        success=True,
        document_id=doc_id,
        chunks_created=0,
        message="Document ingestion queued",
        queued=True,
        job_id=doc_id,
    )


@router.post("/documents/upload", response_model=DocumentAddResponse)
async def upload_document(
    file: UploadFile = File(..., description="File to upload"),
    metadata: Optional[str] = Form(None, description="Optional metadata as JSON string"),
    document_id: Optional[str] = Form(None, description="Optional custom document ID"),
    background_tasks: BackgroundTasks = None,
):
    """Upload a file to the knowledge base.

    The uploaded file is validated and written to disk during the request,
    but heavy ingestion work is delegated to a background task so callers
    (including Convex workflows) don't block on cognee processing.
    """
    try:
        # Read file content
        content = await file.read()

        # Validate file size (50MB default limit from config)
        max_size_mb = (
            settings.max_document_size_mb
            if hasattr(settings, "max_document_size_mb")
            else 50
        )
        max_size_bytes = max_size_mb * 1024 * 1024

        if len(content) > max_size_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"File size exceeds maximum allowed size of {max_size_mb}MB",
            )

        # Create file on disk with original extension in the ingest directory
        ingest_dir = os.path.join(settings.cognee_data_dir, "ingest")
        os.makedirs(ingest_dir, exist_ok=True)
        file_ext = os.path.splitext(file.filename)[1] if file.filename else ""
        tmp_path = os.path.join(ingest_dir, f"upload_{uuid4().hex}{file_ext}")
        with open(tmp_path, "wb") as tmp:
            tmp.write(content)

        # Parse metadata
        parsed_metadata: Dict[str, Any] = {}
        if metadata:
            try:
                parsed_metadata = json.loads(metadata)
            except json.JSONDecodeError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid metadata format. Must be valid JSON string.",
                )

        # Add file metadata
        parsed_metadata["filename"] = file.filename
        parsed_metadata["content_type"] = file.content_type
        parsed_metadata["file_size"] = len(content)

        # Determine document/job id
        doc_id = document_id or f"file-{uuid4().hex}"

        # Create an initial queued job record so callers can immediately query status.
        job_store.create_queued(job_id=doc_id, document_id=doc_id)

        # Enqueue background ingestion of the file path
        async def _background_ingest_file(
            path: str,
            metadata_dict: Dict[str, Any],
            doc_id_inner: str,
        ) -> None:
            try:
                job_store.mark_running(job_id=doc_id_inner)
                result = await cognee_service.add_document(
                    content=path,
                    metadata=metadata_dict,
                    document_id=doc_id_inner,
                )
                job_store.mark_completed(
                    job_id=doc_id_inner,
                    document_id=result.get("document_id", doc_id_inner),
                    chunks_created=result.get("chunks_created", 0),
                )
                logger.info(
                    "Background file ingestion completed",
                    extra={
                        "document_id": result.get("document_id", doc_id_inner),
                        "chunks_created": result.get("chunks_created", 0),
                    },
                )
            except Exception as exc:  # pragma: no cover - best-effort logging
                job_store.mark_failed(job_id=doc_id_inner, error=str(exc))
                logger.error(
                    "Background file ingestion failed",
                    extra={
                        "document_id": doc_id_inner,
                        "error": str(exc),
                    },
                )
            finally:
                # Clean up file after ingestion attempt
                try:
                    if os.path.exists(path):
                        os.unlink(path)
                        logger.debug(f"Cleaned up ingest file: {path}")
                except Exception as cleanup_exc:  # pragma: no cover - best-effort logging
                    logger.warning(
                        "Failed to clean up ingest file",
                        extra={"path": path, "error": str(cleanup_exc)},
                    )

                # Run memory cleanup after each background ingestion task
                cleanup_memory(context=f"after background file ingestion for {doc_id_inner}")

        if background_tasks is not None:
            background_tasks.add_task(
                _background_ingest_file,
                tmp_path,
                parsed_metadata,
                doc_id,
            )
        else:
            # Fallback for contexts without BackgroundTasks (should be rare)
            await _background_ingest_file(tmp_path, parsed_metadata, doc_id)

        return DocumentAddResponse(
            success=True,
            document_id=doc_id,
            chunks_created=0,
            message=f"File '{file.filename}' upload queued for ingestion",
            queued=True,
            job_id=doc_id,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to upload file: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to upload file: {str(e)}",
        )


@router.delete("/documents/{document_id}", response_model=DocumentDeleteResponse)
async def delete_document(document_id: str):
    """Delete a document from the knowledge base."""
    try:
        result = await cognee_service.delete_document(document_id)

        return DocumentDeleteResponse(
            success=result["success"],
            message=result.get("message", "Document deleted successfully"),
        )

    except Exception as e:
        logger.error(f"Failed to delete document: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete document: {str(e)}",
        )


@router.post("/documents/batch", response_model=BatchAddResponse)
async def add_documents_batch(request: BatchAddRequest):
    """Add multiple documents to the knowledge base."""
    results = []
    successful = 0
    failed = 0

    for doc_request in request.documents:
        try:
            result = await cognee_service.add_document(
                content=doc_request.content,
                metadata=doc_request.metadata,
                document_id=doc_request.document_id,
            )
            results.append(
                DocumentAddResponse(
                    success=True,
                    document_id=result["document_id"],
                    chunks_created=result.get("chunks_created", 0),
                    message="Document added successfully",
                )
            )
            successful += 1
        except Exception as e:
            logger.error(f"Failed to add document in batch: {e}")
            results.append(
                DocumentAddResponse(
                    success=False,
                    document_id=doc_request.document_id or "unknown",
                    chunks_created=0,
                    message=f"Failed: {str(e)}",
                )
            )
            failed += 1

    return BatchAddResponse(
        success=failed == 0,
        total_documents=len(request.documents),
        successful=successful,
        failed=failed,
        results=results,
    )





"""Document management endpoints for Tale RAG service."""

import json
import os
from typing import Any
from uuid import uuid4

import aiofiles
from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from fastapi.background import BackgroundTasks
from loguru import logger

from ..config import settings
from ..models import (
    DocumentAddRequest,
    DocumentAddResponse,
    DocumentDeleteResponse,
)
from ..services import job_store_db as job_store
from ..services.cognee import cognee_service
from ..secret_scanner import scan_file_for_secrets
from ..utils import cleanup_memory

router = APIRouter(prefix="/api/v1", tags=["Documents"])


def _parse_team_ids(team_ids: str | None, *, required: bool = False) -> list[str] | None:
    """Parse and sanitize comma-separated team IDs.

    Args:
        team_ids: Comma-separated team ID string
        required: If True, raises HTTPException when no valid IDs

    Returns:
        List of sanitized team IDs, or None if input is None/empty

    Raises:
        HTTPException: If required=True and no valid IDs after sanitization
    """
    if not team_ids:
        if required:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="At least one valid team_id is required",
            )
        return None

    from app.services.cognee.utils import sanitize_team_id

    result: list[str] = []
    for tid in team_ids.split(","):
        tid = tid.strip()
        if tid:
            try:
                sanitized = sanitize_team_id(tid)
                if sanitized:
                    result.append(sanitized)
            except ValueError:
                # Skip team IDs that sanitize to empty (invalid characters only)
                continue

    if not result:
        if required:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="At least one valid team_id is required",
            )
        return None

    return result


async def _persist_text_content(content: str) -> str:
    """Persist text content to a file for cognee."""
    ingest_dir = os.path.join(settings.cognee_data_dir, "ingest")
    os.makedirs(ingest_dir, exist_ok=True)

    file_path = os.path.join(ingest_dir, f"text_{uuid4().hex}.txt")
    async with aiofiles.open(file_path, "w", encoding="utf-8") as f:
        await f.write(content)

    file_size = os.path.getsize(file_path)
    logger.info(f"Text content persisted: {file_path} ({file_size} bytes)")
    return file_path


async def _ingest_single_document(
    content: str,
    metadata: dict[str, Any] | None,
    document_id: str | None,
    user_id: str | None = None,
    team_ids: list[str] | None = None,
) -> DocumentAddResponse:
    """Ingest a single text document."""
    # Persist text content to file so cognee can operate on a path
    file_path = await _persist_text_content(content)

    try:
        # Add to cognee with multi-tenant support
        result = await cognee_service.add_document(
            content=file_path,
            metadata=metadata,
            document_id=document_id,
            user_id=user_id,
            team_ids=team_ids,
        )

        success = result.get("success", False)
        skipped = result.get("skipped", False)
        return DocumentAddResponse(
            success=success,
            document_id=result.get("document_id", document_id or "unknown"),
            chunks_created=result.get("chunks_created", 0),
            message="Document added successfully" if success else "Document ingestion failed",
            skipped=skipped,
            skip_reason=result.get("skip_reason"),
        )
    finally:
        # Clean up the temporary file after ingestion
        try:
            if os.path.exists(file_path):
                os.unlink(file_path)
                logger.debug(f"Cleaned up ingest file: {file_path}")
        except OSError as cleanup_exc:  # pragma: no cover - best-effort cleanup
            logger.warning(
                "Failed to clean up ingest file",
                extra={"path": file_path, "error": str(cleanup_exc)},
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
    await job_store.create_queued(job_id=doc_id, document_id=doc_id)

    async def _background_ingest_text(
        content: str,
        metadata: dict[str, Any] | None,
        document_id: str,
        user_id: str | None = None,
        team_ids: list[str] | None = None,
    ) -> None:
        try:
            await job_store.mark_running(job_id=document_id)
            response = await _ingest_single_document(
                content=content,
                metadata=metadata,
                document_id=document_id,
                user_id=user_id,
                team_ids=team_ids,
            )
            logger.info(
                "_ingest_single_document() returned, calling mark_completed",
                extra={"document_id": document_id},
            )
            await job_store.mark_completed(
                job_id=document_id,
                document_id=response.document_id,
                chunks_created=response.chunks_created,
                skipped=response.skipped,
                skip_reason=response.skip_reason,
            )
            logger.info(
                "Background text ingestion completed",
                extra={
                    "document_id": document_id,
                    "chunks_created": response.chunks_created,
                    "skipped": response.skipped,
                },
            )
        except Exception as exc:  # pragma: no cover - best-effort logging
            await job_store.mark_failed(job_id=document_id, error=str(exc))
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
        request.user_id,
        request.team_ids,
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
    metadata: str | None = Form(None, description="Optional metadata as JSON string"),
    document_id: str | None = Form(None, description="Optional custom document ID"),
    user_id: str | None = Form(None, description="User ID for multi-tenant isolation"),
    team_ids: str = Form(..., description="Comma-separated team IDs (required, e.g., 'team1,team2')"),
    background_tasks: BackgroundTasks = None,
):
    """Upload a file to the knowledge base.

    The uploaded file is validated and written to disk during the request,
    but heavy ingestion work is delegated to a background task so callers
    (including Convex workflows) don't block on cognee processing.

    For documents belonging to multiple teams, pass comma-separated team IDs.
    The document will be added to ALL specified teams' datasets.
    """
    from pathlib import Path

    team_id_list = _parse_team_ids(team_ids, required=True)

    SUPPORTED_EXTENSIONS = {
        # Documents
        ".pdf", ".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls",
        # Images
        ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".webp",
        # Text / markup
        ".txt", ".md", ".mdx", ".rst", ".tex", ".csv", ".tsv",
        ".html", ".htm", ".css", ".scss", ".sass", ".less",
        # Data / config
        ".json", ".yaml", ".yml", ".toml", ".xml", ".ini", ".cfg",
        ".conf", ".properties",
        # Code
        ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
        ".py", ".pyi",
        ".c", ".h", ".cpp", ".hpp", ".cc", ".cxx",
        ".rs", ".go", ".swift", ".kt", ".java",
        ".rb", ".php", ".pl", ".lua", ".r",
        ".scala", ".groovy", ".dart", ".ex", ".exs",
        # Shell / scripts
        ".sh", ".bash", ".zsh", ".ps1", ".bat", ".cmd",
        # Query / schema
        ".sql", ".graphql", ".gql", ".proto",
        # Build / project
        ".gradle", ".cmake", ".lock",
    }

    tmp_path: str | None = None
    try:
        if not file.filename:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Filename is required"
            )

        file_ext = Path(file.filename).suffix.lower()
        if not file_ext:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File must have an extension. Supported formats: {', '.join(sorted(SUPPORTED_EXTENSIONS))}"
            )

        if file_ext not in SUPPORTED_EXTENSIONS:
            supported = ', '.join(sorted(SUPPORTED_EXTENSIONS))
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported file type: {file_ext}. Supported formats: {supported}"
            )

        # Validate file size (50MB default limit from config)
        max_size_mb = (
            settings.max_document_size_mb
            if hasattr(settings, "max_document_size_mb")
            else 50
        )
        max_size_bytes = max_size_mb * 1024 * 1024

        # Create file on disk with original extension in the ingest directory
        ingest_dir = os.path.join(settings.cognee_data_dir, "ingest")
        os.makedirs(ingest_dir, exist_ok=True)
        tmp_path = os.path.join(ingest_dir, f"upload_{uuid4().hex}{file_ext}")

        # Stream file to disk in chunks to avoid loading entire file into memory
        total_size = 0
        async with aiofiles.open(tmp_path, "wb") as tmp:
            while chunk := await file.read(64 * 1024):  # 64KB chunks
                total_size += len(chunk)
                if total_size > max_size_bytes:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=f"File size exceeds maximum allowed size of {max_size_mb}MB",
                    )
                await tmp.write(chunk)

        # Scan for embedded secrets before ingestion
        async with aiofiles.open(tmp_path, "rb") as f:
            file_bytes = await f.read()
        rejected, reason = scan_file_for_secrets(file_bytes)
        if rejected:
            logger.warning(
                "Upload rejected by secret scanner",
                extra={"filename": file.filename, "reason": reason},
            )
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"File rejected: {reason}",
            )

        # Parse metadata
        parsed_metadata: dict[str, Any] = {}
        if metadata:
            try:
                parsed_value = json.loads(metadata)
                if not isinstance(parsed_value, dict):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Invalid metadata format. Must be a JSON object.",
                    )
                parsed_metadata = parsed_value
            except json.JSONDecodeError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid metadata format. Must be valid JSON string.",
                )

        # Add file metadata
        parsed_metadata["filename"] = file.filename
        parsed_metadata["content_type"] = file.content_type
        parsed_metadata["file_size"] = total_size

        # Determine document/job id
        doc_id = document_id or f"file-{uuid4().hex}"

        # Create an initial queued job record so callers can immediately query status.
        await job_store.create_queued(job_id=doc_id, document_id=doc_id)

        # Enqueue background ingestion of the file path
        async def _background_ingest_file(
            path: str,
            metadata_dict: dict[str, Any],
            doc_id_inner: str,
            user_id_inner: str | None = None,
            team_ids_inner: list[str] | None = None,
        ) -> None:
            try:
                await job_store.mark_running(job_id=doc_id_inner)
                result = await cognee_service.add_document(
                    content=path,
                    metadata=metadata_dict,
                    document_id=doc_id_inner,
                    user_id=user_id_inner,
                    team_ids=team_ids_inner,
                )
                logger.info(
                    "add_document() returned, calling mark_completed",
                    extra={
                        "document_id": doc_id_inner,
                        "result_keys": list(result.keys()) if result else [],
                    },
                )
                await job_store.mark_completed(
                    job_id=doc_id_inner,
                    document_id=result.get("document_id", doc_id_inner),
                    chunks_created=result.get("chunks_created", 0),
                    skipped=result.get("skipped", False),
                    skip_reason=result.get("skip_reason"),
                )
                if result.get("skipped"):
                    logger.info(
                        "Background file ingestion skipped (content unchanged)",
                        extra={
                            "document_id": result.get("document_id", doc_id_inner),
                            "skip_reason": result.get("skip_reason"),
                        },
                    )
                else:
                    logger.info(
                        "Background file ingestion completed",
                        extra={
                            "document_id": result.get("document_id", doc_id_inner),
                            "chunks_created": result.get("chunks_created", 0),
                        },
                    )
            except Exception as exc:  # pragma: no cover - best-effort logging
                await job_store.mark_failed(job_id=doc_id_inner, error=str(exc))
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
                user_id,
                team_id_list,
            )
        else:
            # Fallback for contexts without BackgroundTasks (should be rare)
            await _background_ingest_file(tmp_path, parsed_metadata, doc_id, user_id, team_id_list)

        return DocumentAddResponse(
            success=True,
            document_id=doc_id,
            chunks_created=0,
            message=f"File '{file.filename}' upload queued for ingestion",
            queued=True,
            job_id=doc_id,
        )

    except HTTPException:
        # Clean up temp file on validation errors
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
        raise
    except Exception as e:
        # Clean up temp file on unexpected errors
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
        logger.error(f"Failed to upload file: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to upload file. Please try again.",
        )


@router.delete("/documents/{document_id}", response_model=DocumentDeleteResponse)
async def delete_document(
    document_id: str,
    mode: str = "hard",
    team_ids: str | None = None,
):
    """Delete a document from the knowledge base by ID.

    This endpoint finds documents in Cognee that were tagged with the given
    document_id (via node_set) and deletes them along with their associated
    knowledge graph nodes and vector embeddings.

    Args:
        document_id: The document ID (should match the ID used when uploading)
        mode: "soft" or "hard" - "hard" (default) also deletes degree-one entity nodes
        team_ids: Comma-separated team IDs for multi-tenant authorization (required for
                  documents added with team isolation)
    """
    team_id_list = _parse_team_ids(team_ids, required=False)

    try:
        result = await cognee_service.delete_document(
            document_id, mode=mode, team_ids=team_id_list
        )

        return DocumentDeleteResponse(
            success=result["success"],
            message=result.get("message", "Document deleted successfully"),
            deleted_count=result.get("deleted_count", 0),
            deleted_data_ids=result.get("deleted_data_ids", []),
            processing_time_ms=result.get("processing_time_ms"),
        )

    except Exception as e:
        logger.error(f"Failed to delete document {document_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete document. Please try again.",
        )


@router.post("/reset")
async def reset_knowledge_base():
    """Reset the entire knowledge base (delete all data).

    WARNING: This will permanently delete all documents, embeddings,
    knowledge graph data, and job history. Use with caution.
    """
    try:
        result = await cognee_service.reset()
        return {
            "success": True,
            "message": "Knowledge base reset successfully. All data has been deleted.",
            "jobs_deleted": result.get("jobs_deleted", 0),
        }
    except Exception as e:
        logger.error(f"Failed to reset knowledge base: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to reset knowledge base. Please try again.",
        )

"""Document management endpoints for Tale RAG service."""

import json
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from fastapi.background import BackgroundTasks
from loguru import logger

from ..config import settings
from ..models import (
    DocumentAddRequest,
    DocumentAddResponse,
    DocumentDeleteResponse,
)
from ..secret_scanner import scan_file_for_secrets
from ..services import job_store_db as job_store
from ..services.rag_service import rag_service
from ..utils import cleanup_memory
from ..utils.sanitize import sanitize_team_id

router = APIRouter(prefix="/api/v1", tags=["Documents"])

_FILE_UPLOAD = File(..., description="File to upload")


def _parse_team_ids(team_ids: str | None, *, required: bool = False) -> list[str] | None:
    """Parse and sanitize comma-separated team IDs."""
    if not team_ids:
        if required:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="At least one valid team_id is required",
            )
        return None

    result: list[str] = []
    for tid in team_ids.split(","):
        tid = tid.strip()
        if tid:
            try:
                sanitized = sanitize_team_id(tid)
                if sanitized:
                    result.append(sanitized)
            except ValueError:
                continue

    if not result:
        if required:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="At least one valid team_id is required",
            )
        return None

    return result


@router.post("/documents", response_model=DocumentAddResponse)
async def add_document(request: DocumentAddRequest, background_tasks: BackgroundTasks):
    """Add a text document to the knowledge base.

    Heavy ingestion work is delegated to a background task so callers
    (including Convex workflows) don't block on processing.
    """
    doc_id = request.document_id or f"doc-{uuid4().hex}"

    await job_store.create_queued(job_id=doc_id, document_id=doc_id)

    async def _background_ingest_text(
        content: str,
        document_id: str,
        user_id: str | None = None,
        team_ids: list[str] | None = None,
    ) -> None:
        try:
            await job_store.mark_running(job_id=document_id)
            content_bytes = content.encode("utf-8")
            result = await rag_service.add_document(
                content=content_bytes,
                document_id=document_id,
                filename=f"{document_id}.txt",
                user_id=user_id,
                team_ids=team_ids,
            )
            await job_store.mark_completed(
                job_id=document_id,
                document_id=result.get("document_id", document_id),
                chunks_created=result.get("chunks_created", 0),
                skipped=result.get("skipped", False),
                skip_reason=result.get("skip_reason"),
            )
            logger.info(
                "Background text ingestion completed",
                extra={
                    "document_id": document_id,
                    "chunks_created": result.get("chunks_created", 0),
                    "skipped": result.get("skipped", False),
                },
            )
        except Exception as exc:
            await job_store.mark_failed(job_id=document_id, error=str(exc))
            logger.error(
                "Background text ingestion failed",
                extra={"document_id": document_id, "error": str(exc)},
            )
        finally:
            cleanup_memory(context=f"after background text ingestion for {document_id}")

    background_tasks.add_task(
        _background_ingest_text,
        request.content,
        doc_id,
        request.user_id,
        request.team_ids,
    )

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
    file: UploadFile = _FILE_UPLOAD,
    metadata: str | None = Form(None, description="Optional metadata as JSON string"),
    document_id: str | None = Form(None, description="Optional custom document ID"),
    user_id: str | None = Form(None, description="User ID for multi-tenant isolation"),
    team_ids: str = Form(..., description="Comma-separated team IDs (required, e.g., 'team1,team2')"),
    background_tasks: BackgroundTasks = None,
):
    """Upload a file to the knowledge base.

    The uploaded file is validated and read into memory during the request,
    but heavy ingestion work is delegated to a background task.
    """
    team_id_list = _parse_team_ids(team_ids, required=True)

    SUPPORTED_EXTENSIONS = {
        # Documents
        ".pdf",
        ".docx",
        ".doc",
        ".pptx",
        ".ppt",
        ".xlsx",
        ".xls",
        # Images
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".bmp",
        ".tiff",
        ".webp",
        # Text / markup
        ".txt",
        ".md",
        ".mdx",
        ".rst",
        ".tex",
        ".csv",
        ".tsv",
        ".html",
        ".htm",
        ".css",
        ".scss",
        ".sass",
        ".less",
        # Data / config
        ".json",
        ".yaml",
        ".yml",
        ".toml",
        ".xml",
        ".ini",
        ".cfg",
        ".conf",
        ".properties",
        # Code
        ".js",
        ".jsx",
        ".ts",
        ".tsx",
        ".mjs",
        ".cjs",
        ".py",
        ".pyi",
        ".c",
        ".h",
        ".cpp",
        ".hpp",
        ".cc",
        ".cxx",
        ".rs",
        ".go",
        ".swift",
        ".kt",
        ".java",
        ".rb",
        ".php",
        ".pl",
        ".lua",
        ".r",
        ".scala",
        ".groovy",
        ".dart",
        ".ex",
        ".exs",
        # Shell / scripts
        ".sh",
        ".bash",
        ".zsh",
        ".ps1",
        ".bat",
        ".cmd",
        # Query / schema
        ".sql",
        ".graphql",
        ".gql",
        ".proto",
        # Build / project
        ".gradle",
        ".cmake",
        ".lock",
    }

    try:
        from pathlib import Path

        if not file.filename:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Filename is required")

        file_ext = Path(file.filename).suffix.lower()
        if not file_ext:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File must have an extension. Supported formats: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
            )

        if file_ext not in SUPPORTED_EXTENSIONS:
            supported = ", ".join(sorted(SUPPORTED_EXTENSIONS))
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported file type: {file_ext}. Supported formats: {supported}",
            )

        # Validate file size
        max_size_mb = settings.max_document_size_mb
        max_size_bytes = max_size_mb * 1024 * 1024

        # Read file into memory with streaming size check
        chunks: list[bytes] = []
        total_size = 0
        while chunk := await file.read(64 * 1024):
            total_size += len(chunk)
            if total_size > max_size_bytes:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=f"File size exceeds maximum allowed size of {max_size_mb}MB",
                )
            chunks.append(chunk)

        file_bytes = b"".join(chunks)

        # Scan for embedded secrets before ingestion
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
                ) from None

        parsed_metadata["filename"] = file.filename
        parsed_metadata["content_type"] = file.content_type
        parsed_metadata["file_size"] = total_size

        doc_id = document_id or f"file-{uuid4().hex}"

        await job_store.create_queued(job_id=doc_id, document_id=doc_id)

        async def _background_ingest_file(
            content: bytes,
            filename: str,
            doc_id_inner: str,
            user_id_inner: str | None = None,
            team_ids_inner: list[str] | None = None,
        ) -> None:
            try:
                await job_store.mark_running(job_id=doc_id_inner)
                result = await rag_service.add_document(
                    content=content,
                    document_id=doc_id_inner,
                    filename=filename,
                    user_id=user_id_inner,
                    team_ids=team_ids_inner,
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
            except Exception as exc:
                await job_store.mark_failed(job_id=doc_id_inner, error=str(exc))
                logger.error(
                    "Background file ingestion failed",
                    extra={
                        "document_id": doc_id_inner,
                        "error": str(exc),
                    },
                )
            finally:
                cleanup_memory(context=f"after background file ingestion for {doc_id_inner}")

        if background_tasks is not None:
            background_tasks.add_task(
                _background_ingest_file,
                file_bytes,
                file.filename,
                doc_id,
                user_id,
                team_id_list,
            )
        else:
            await _background_ingest_file(file_bytes, file.filename, doc_id, user_id, team_id_list)

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
            detail="Failed to upload file. Please try again.",
        ) from e


@router.delete("/documents/{document_id}", response_model=DocumentDeleteResponse)
async def delete_document(
    document_id: str,
    team_ids: str | None = None,
):
    """Delete a document from the knowledge base by ID."""
    team_id_list = _parse_team_ids(team_ids, required=False)

    try:
        result = await rag_service.delete_document(document_id, team_ids=team_id_list)

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
        ) from e


@router.post("/reset")
async def reset_knowledge_base():
    """Reset the entire knowledge base (delete all data).

    WARNING: This will permanently delete all documents, embeddings,
    and job history in the private_knowledge schema. Crawler data is untouched.
    """
    try:
        result = await rag_service.reset()
        return {
            "success": True,
            "message": "Knowledge base reset successfully. All data has been deleted.",
        }
    except Exception as e:
        logger.error(f"Failed to reset knowledge base: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to reset knowledge base. Please try again.",
        ) from e

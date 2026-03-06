"""Document management endpoints for Tale RAG service."""

import json
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile, status
from fastapi.background import BackgroundTasks
from loguru import logger

from ..config import settings
from ..models import (
    DocumentAddRequest,
    DocumentAddResponse,
    DocumentContentResponse,
    DocumentDeleteResponse,
)
from ..secret_scanner import scan_file_for_secrets
from ..services import job_store_db as job_store
from ..services.rag_service import rag_service
from ..utils import cleanup_memory
from ..utils.sanitize import sanitize_team_id

router = APIRouter(prefix="/api/v1", tags=["Documents"])

_FILE_UPLOAD = File(..., description="File to upload")

SUPPORTED_EXTENSIONS = {
    # Documents
    ".pdf",
    ".docx",
    ".pptx",
    ".xlsx",
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


async def _background_ingest(
    content: bytes,
    document_id: str,
    filename: str,
    user_id: str | None = None,
    team_ids: list[str] | None = None,
) -> None:
    """Run document ingestion in the background, updating job status."""
    try:
        await job_store.mark_running(job_id=document_id)
        result = await rag_service.add_document(
            content=content,
            document_id=document_id,
            filename=filename,
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
            "Background ingestion completed",
            extra={
                "document_id": document_id,
                "filename": filename,
                "chunks_created": result.get("chunks_created", 0),
                "skipped": result.get("skipped", False),
            },
        )
    except Exception as exc:
        await job_store.mark_failed(job_id=document_id, error=str(exc))
        logger.opt(exception=True).error(
            "Background ingestion failed for {}: {}",
            document_id,
            exc,
        )
    finally:
        cleanup_memory(context=f"after background ingestion for {document_id}")


def _validate_file_extension(filename: str) -> str:
    """Validate file extension. Returns the extension or raises HTTPException."""
    file_ext = Path(filename).suffix.lower()
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

    return file_ext


async def _read_upload_with_size_check(file: UploadFile, max_size_mb: int) -> bytes:
    """Read uploaded file with streaming size check."""
    max_size_bytes = max_size_mb * 1024 * 1024
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
    return b"".join(chunks)


def _parse_metadata(metadata_str: str | None) -> dict[str, Any]:
    """Parse optional JSON metadata string."""
    if not metadata_str:
        return {}

    try:
        parsed_value = json.loads(metadata_str)
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid metadata format. Must be valid JSON string.",
        ) from None

    if not isinstance(parsed_value, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid metadata format. Must be a JSON object.",
        )

    return parsed_value


@router.post("/documents", response_model=DocumentAddResponse)
async def add_document(request: DocumentAddRequest, background_tasks: BackgroundTasks):
    """Add a text document to the knowledge base.

    Heavy ingestion work is delegated to a background task so callers
    (including Convex workflows) don't block on processing.
    """
    rejected, reason = scan_file_for_secrets(request.content.encode("utf-8"))
    if rejected:
        logger.warning(
            "Text document rejected by secret scanner",
            extra={"reason": reason},
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Document rejected: {reason}",
        )

    doc_id = request.document_id or f"doc-{uuid4().hex}"
    await job_store.create_queued(job_id=doc_id, document_id=doc_id)

    background_tasks.add_task(
        _background_ingest,
        request.content.encode("utf-8"),
        doc_id,
        f"{doc_id}.txt",
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

    try:
        if not file.filename:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Filename is required")

        _validate_file_extension(file.filename)

        file_bytes = await _read_upload_with_size_check(file, settings.max_document_size_mb)

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

        _parse_metadata(metadata)

        doc_id = document_id or f"file-{uuid4().hex}"
        await job_store.create_queued(job_id=doc_id, document_id=doc_id)

        if background_tasks is not None:
            background_tasks.add_task(
                _background_ingest,
                file_bytes,
                doc_id,
                file.filename,
                user_id,
                team_id_list,
            )
        else:
            await _background_ingest(file_bytes, doc_id, file.filename, user_id, team_id_list)

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
        logger.error("Failed to upload file: {}", e)
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
    team_id_list = _parse_team_ids(team_ids, required=True)

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
        logger.error("Failed to delete document {}: {}", document_id, e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete document. Please try again.",
        ) from e


@router.get("/documents/{document_id}/content", response_model=DocumentContentResponse)
async def get_document_content(
    document_id: str,
    chunk_start: int = Query(default=1, ge=1, description="Start chunk (1-indexed)"),
    chunk_end: int | None = Query(default=None, ge=1, description="End chunk (1-indexed, inclusive)"),
    team_ids: str | None = Query(default=None, description="Comma-separated team IDs"),
    user_id: str | None = Query(default=None, description="User ID for private documents"),
):
    """Retrieve full document text by reassembling stored chunks.

    Use chunk_start/chunk_end to paginate through large documents.
    """
    team_id_list = _parse_team_ids(team_ids)

    if not team_id_list and not user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one of team_ids or user_id is required",
        )

    if chunk_end is not None and chunk_start > chunk_end:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="chunk_start must be <= chunk_end",
        )

    try:
        result = await rag_service.get_document_content(
            document_id,
            team_ids=team_id_list,
            user_id=user_id,
            chunk_start=chunk_start,
            chunk_end=chunk_end,
        )
    except Exception as e:
        logger.error("Failed to retrieve document content for {}: {}", document_id, e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve document content.",
        ) from e

    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found",
        )

    return DocumentContentResponse(**result)

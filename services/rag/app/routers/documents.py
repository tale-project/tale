"""Document management endpoints for Tale RAG service."""

import datetime as dt
import json
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from fastapi.background import BackgroundTasks
from loguru import logger
from tale_shared.db import acquire_with_retry

from ..auth import require_org_slug
from ..config import settings
from ..models import (
    DocumentAddResponse,
    DocumentCompareRequest,
    DocumentCompareResponse,
    DocumentContentResponse,
    DocumentDeleteResponse,
    DocumentMetadataUpdateRequest,
    DocumentMetadataUpdateResponse,
    DocumentStatusInfo,
    DocumentStatusRequest,
    DocumentStatusResponse,
    FolderPathUpdateRequest,
    FolderPathUpdateResponse,
)
from ..secret_scanner import scan_file_for_secrets
from ..services.database import SCHEMA, get_pool
from ..services.rag_service import rag_service
from ..utils import cleanup_memory
from ..utils.document_metadata import sanitize_document_metadata
from ..utils.folder_path import MAX_FOLDER_PATH_LENGTH, normalize_folder_path

router = APIRouter(prefix="/api/v1", tags=["Documents"])

_FILE_UPLOAD = File(..., description="File to upload")
_BASE_FILE = File(..., description="Base document file")
_COMPARISON_FILE = File(..., description="Comparison document file")
_MAX_CHANGES_FORM = Form(default=500, ge=1, le=2000, description="Maximum number of change items")

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


async def _insert_processing_row(
    org_slug: str,
    file_id: str,
    filename: str,
    folder_path: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Insert a processing status row at ingestion start (scoped to org).

    `folder_path` and `metadata` are written here (insert AND
    conflict-update) because this upsert runs unconditionally per upload —
    the later `_do_store` / `_do_clone` upserts never touch the columns,
    and `_do_store` skips its UPDATE entirely when content is unchanged.
    """
    pool = await get_pool()
    async with acquire_with_retry(pool) as conn:
        await conn.execute(
            f"""
            INSERT INTO {SCHEMA}.documents (org_slug, file_id, filename, status, folder_path, metadata)
            VALUES ($1, $2, $3, 'processing', $4, $5::jsonb)
            ON CONFLICT (org_slug, file_id)
            DO UPDATE SET status = 'processing', error = NULL, chunks_count = 0,
                         progress_phase = NULL, progress_detail = NULL,
                         folder_path = EXCLUDED.folder_path,
                         metadata = EXCLUDED.metadata,
                         updated_at = NOW()
            """,
            org_slug,
            file_id,
            filename,
            folder_path,
            json.dumps(metadata or {}),
        )


async def _record_failure(
    org_slug: str,
    file_id: str,
    filename: str,
    error: str,
) -> None:
    """Record failure status in documents table (scoped to org)."""
    pool = await get_pool()
    async with acquire_with_retry(pool) as conn:
        await conn.execute(
            f"""
            INSERT INTO {SCHEMA}.documents (org_slug, file_id, filename, status, error)
            VALUES ($1, $2, $3, 'failed', $4)
            ON CONFLICT (org_slug, file_id)
            DO UPDATE SET status = 'failed', error = EXCLUDED.error, chunks_count = 0,
                         progress_phase = NULL, progress_detail = NULL,
                         updated_at = NOW()
            """,
            org_slug,
            file_id,
            filename,
            error,
        )


async def _mark_completed(
    org_slug: str,
    file_id: str,
) -> None:
    """Mark document status as completed and restore chunks_count from actual chunk rows."""
    pool = await get_pool()
    async with acquire_with_retry(pool) as conn:
        await conn.execute(
            f"""
            UPDATE {SCHEMA}.documents d
            SET status = 'completed',
                error = NULL,
                chunks_count = (
                    SELECT COUNT(*) FROM {SCHEMA}.chunks c
                    WHERE c.document_id = d.id AND c.org_slug = $1
                ),
                updated_at = NOW()
            WHERE d.org_slug = $1 AND d.file_id = $2
            """,
            org_slug,
            file_id,
        )


def _sanitize_error(exc: Exception, max_length: int = 500) -> str:
    """Return a truncated error message safe for DB storage."""
    msg = str(exc)
    if len(msg) > max_length:
        return msg[:max_length] + "..."
    return msg


async def _background_ingest(
    org_slug: str,
    content: bytes,
    file_id: str,
    filename: str,
    source_created_at: dt.datetime | None = None,
    source_modified_at: dt.datetime | None = None,
) -> None:
    """Run document ingestion in the background, recording status in documents table."""
    try:
        result = await rag_service.add_document(
            org_slug,
            content=content,
            file_id=file_id,
            filename=filename,
            source_created_at=source_created_at,
            source_modified_at=source_modified_at,
        )
        if result.get("skipped"):
            await _mark_completed(org_slug, file_id)
        logger.info(
            "Background ingestion completed",
            extra={
                "file_id": file_id,
                "filename": filename,
                "chunks_created": result.get("chunks_created", 0),
                "skipped": result.get("skipped", False),
            },
        )
    except Exception as exc:
        logger.opt(exception=True).error(
            "Background ingestion failed for {}",
            file_id,
        )
        try:
            await _record_failure(org_slug, file_id, filename, _sanitize_error(exc))
        except Exception as record_exc:
            logger.critical("Could not record failure for {}: {}", file_id, record_exc)
    finally:
        cleanup_memory(context=f"after background ingestion for {file_id}")


def _validate_file_extension(filename: str) -> str:
    """Validate file extension. Returns the extension or raises HTTPException."""
    file_ext = Path(filename).suffix.lower()
    if not file_ext:
        logger.warning("Upload rejected (400): missing extension | filename={}", filename)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File must have an extension. Supported formats: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
        )

    if file_ext not in SUPPORTED_EXTENSIONS:
        supported = ", ".join(sorted(SUPPORTED_EXTENSIONS))
        logger.warning(
            "Upload rejected (400): unsupported extension | filename={} ext={}",
            filename,
            file_ext,
        )
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
            logger.warning(
                "Upload rejected (413): size over limit | filename={} max_mb={}",
                file.filename,
                max_size_mb,
            )
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
    except json.JSONDecodeError as exc:
        logger.warning(
            "Upload rejected (400): invalid metadata JSON | error={} preview={!r}",
            exc,
            metadata_str[:200],
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid metadata format. Must be valid JSON string.",
        ) from None

    if not isinstance(parsed_value, dict):
        logger.warning(
            "Upload rejected (400): metadata not a JSON object | type={}",
            type(parsed_value).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid metadata format. Must be a JSON object.",
        )

    return parsed_value


def _ms_timestamp_to_datetime(value: Any) -> dt.datetime | None:
    """Convert a Unix millisecond timestamp to a timezone-aware datetime."""
    if value is None:
        return None
    try:
        ts = int(value) / 1000.0
        return dt.datetime.fromtimestamp(ts, tz=dt.UTC)
    except (TypeError, ValueError, OverflowError):
        return None


@router.post("/documents/upload", response_model=DocumentAddResponse)
async def upload_document(
    background_tasks: BackgroundTasks,
    org_slug: str = Depends(require_org_slug),
    file: UploadFile = _FILE_UPLOAD,
    metadata: str | None = Form(None, description="Optional metadata as JSON string"),
    file_id: str | None = Form(None, description="Optional custom file ID"),
    sync: bool = Query(False, description="If true, wait for ingestion to complete before responding"),
):
    """Upload a file to the knowledge base.

    By default, heavy ingestion work is delegated to a background task.
    Set `sync=true` to wait for ingestion to complete before responding.
    """
    try:
        if not file.filename:
            logger.warning(
                "Upload rejected (400): missing filename | file_id={} content_type={}",
                file_id,
                file.content_type,
            )
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

        parsed_metadata = _parse_metadata(metadata)
        source_created_at = _ms_timestamp_to_datetime(parsed_metadata.get("source_created_at"))
        source_modified_at = _ms_timestamp_to_datetime(parsed_metadata.get("source_modified_at"))
        folder_path = normalize_folder_path(parsed_metadata.get("folder_path"))
        if folder_path and len(folder_path) > MAX_FOLDER_PATH_LENGTH:
            logger.warning(
                "Ignoring over-long folder_path metadata ({} chars) | filename={}",
                len(folder_path),
                file.filename,
            )
            folder_path = None

        document_metadata = sanitize_document_metadata(parsed_metadata)

        doc_id = file_id or f"file-{uuid4().hex}"

        await _insert_processing_row(org_slug, doc_id, file.filename, folder_path, document_metadata)

        if sync:
            try:
                result = await rag_service.add_document(
                    org_slug,
                    content=file_bytes,
                    file_id=doc_id,
                    filename=file.filename,
                    source_created_at=source_created_at,
                    source_modified_at=source_modified_at,
                )
            except Exception as sync_exc:
                await _record_failure(org_slug, doc_id, file.filename, _sanitize_error(sync_exc))
                raise

            if result.get("skipped"):
                await _mark_completed(org_slug, doc_id)

            skipped = result.get("skipped", False)
            skip_reason = result.get("skip_reason")
            return DocumentAddResponse(
                success=True,
                file_id=doc_id,
                chunks_created=result.get("chunks_created", 0),
                message=f"File '{file.filename}' ingested synchronously",
                queued=False,
                skipped=skipped,
                skip_reason=skip_reason,
            )

        background_tasks.add_task(
            _background_ingest,
            org_slug,
            file_bytes,
            doc_id,
            file.filename,
            source_created_at,
            source_modified_at,
        )

        return DocumentAddResponse(
            success=True,
            file_id=doc_id,
            chunks_created=0,
            message=f"File '{file.filename}' upload queued for ingestion",
            queued=True,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to upload file: {}", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to upload file. Please try again.",
        ) from e


@router.patch("/documents/folder-paths", response_model=FolderPathUpdateResponse)
async def update_folder_paths(
    request: FolderPathUpdateRequest,
    org_slug: str = Depends(require_org_slug),
):
    """Batch-update the denormalized folder_path on indexed documents.

    Keeps the folder-scoped search filter fresh when the platform moves or
    renames folders — no re-extraction or re-embedding. Scoped to the
    caller's org; foreign-org file_ids update zero rows. folder_path is a
    narrowing filter only, so a missed update degrades filter precision but
    never authorization.
    """
    # Last occurrence wins for duplicate file_ids so the UPDATE ... FROM
    # join below stays deterministic.
    deduped: dict[str, str | None] = {u.file_id: u.folder_path for u in request.updates}
    file_ids = list(deduped.keys())
    folder_paths = list(deduped.values())

    try:
        pool = await get_pool()
        async with acquire_with_retry(pool) as conn:
            tag = await conn.execute(
                f"""
                UPDATE {SCHEMA}.documents d
                SET folder_path = u.folder_path, updated_at = NOW()
                FROM unnest($2::text[], $3::text[]) AS u(file_id, folder_path)
                WHERE d.org_slug = $1 AND d.file_id = u.file_id
                """,
                org_slug,
                file_ids,
                folder_paths,
            )
    except Exception as e:
        logger.error("Failed to update folder paths: {}", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update folder paths. Please try again.",
        ) from e

    # asyncpg returns a command tag like "UPDATE 3".
    try:
        updated_count = int(tag.rsplit(" ", 1)[-1])
    except (ValueError, AttributeError):
        logger.warning("Unexpected command tag from folder-path update: {!r}", tag)
        updated_count = 0

    return FolderPathUpdateResponse(success=True, updated_count=updated_count)


@router.patch("/documents/metadata", response_model=DocumentMetadataUpdateResponse)
async def update_document_metadata(
    request: DocumentMetadataUpdateRequest,
    org_slug: str = Depends(require_org_slug),
):
    """Batch-update the filterable metadata on indexed documents (#1517).

    REPLACES each document's stored metadata object with the supplied map
    (no merge) — the platform's canonical record always wins. Lets the
    platform stamp metadata onto documents indexed before the column
    existed, without re-extraction or re-embedding. Scoped to the caller's
    org; foreign-org file_ids update zero rows. Metadata is a narrowing
    filter only, so a missed update degrades filter precision but never
    authorization.
    """
    # Last occurrence wins for duplicate file_ids so the UPDATE ... FROM
    # join below stays deterministic.
    deduped: dict[str, str] = {u.file_id: json.dumps(u.metadata) for u in request.updates}
    file_ids = list(deduped.keys())
    metadata_values = list(deduped.values())

    try:
        pool = await get_pool()
        async with acquire_with_retry(pool) as conn:
            tag = await conn.execute(
                f"""
                UPDATE {SCHEMA}.documents d
                SET metadata = u.metadata::jsonb, updated_at = NOW()
                FROM unnest($2::text[], $3::text[]) AS u(file_id, metadata)
                WHERE d.org_slug = $1 AND d.file_id = u.file_id
                """,
                org_slug,
                file_ids,
                metadata_values,
            )
    except Exception as e:
        logger.error("Failed to update document metadata: {}", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update document metadata. Please try again.",
        ) from e

    # asyncpg returns a command tag like "UPDATE 3".
    try:
        updated_count = int(tag.rsplit(" ", 1)[-1])
    except (ValueError, AttributeError):
        logger.warning("Unexpected command tag from metadata update: {!r}", tag)
        updated_count = 0

    return DocumentMetadataUpdateResponse(success=True, updated_count=updated_count)


@router.delete("/documents/{file_id}", response_model=DocumentDeleteResponse)
async def delete_document(
    file_id: str,
    org_slug: str = Depends(require_org_slug),
):
    """Delete a document from the knowledge base, scoped to caller's org."""
    try:
        result = await rag_service.delete_document(org_slug, file_id)

        return DocumentDeleteResponse(
            success=result["success"],
            message=result.get("message", "Document deleted successfully"),
            deleted_count=result.get("deleted_count", 0),
            deleted_data_ids=result.get("deleted_data_ids", []),
            processing_time_ms=result.get("processing_time_ms"),
        )

    except Exception as e:
        logger.error("Failed to delete document {}: {}", file_id, e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete document. Please try again.",
        ) from e


@router.get("/documents/{file_id}/content", response_model=DocumentContentResponse)
async def get_document_content(
    file_id: str,
    org_slug: str = Depends(require_org_slug),
    chunk_start: int = Query(default=1, ge=1, description="Start chunk (1-indexed)"),
    chunk_end: int | None = Query(default=None, ge=1, description="End chunk (1-indexed, inclusive)"),
    return_chunks: bool = Query(default=False, description="If true, include individual chunks as a list"),
):
    """Retrieve full document text by reassembling stored chunks, scoped to caller's org.

    Use chunk_start/chunk_end to paginate through large documents.
    Set return_chunks=true to get individual chunks as an array.
    """
    if chunk_end is not None and chunk_start > chunk_end:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="chunk_start must be <= chunk_end",
        )

    try:
        result = await rag_service.get_document_content(
            org_slug,
            file_id,
            chunk_start=chunk_start,
            chunk_end=chunk_end,
            return_chunks=return_chunks,
        )
    except Exception as e:
        logger.error("Failed to retrieve document content for {}: {}", file_id, e)
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


@router.post("/documents/compare", response_model=DocumentCompareResponse)
async def compare_documents(
    request: DocumentCompareRequest,
    org_slug: str = Depends(require_org_slug),
):
    """Compare two stored documents (both must belong to caller's org).

    Returns structured change blocks with context, statistics, and
    divergence detection.
    """
    if request.base_file_id == request.comparison_file_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Base and comparison documents must be different",
        )

    try:
        result = await rag_service.compare_documents(
            org_slug,
            request.base_file_id,
            request.comparison_file_id,
            max_changes=request.max_changes,
        )
    except Exception as e:
        logger.error("Failed to compare documents: {}", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to compare documents.",
        ) from e

    if result is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unexpected error during comparison",
        )

    if result.get("error") == "not_found":
        role = result.get("role", "")
        doc_id = result.get("file_id", "")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"{role.capitalize()} document not found: {doc_id}",
        )

    return DocumentCompareResponse(**result)


@router.post("/documents/compare-files", response_model=DocumentCompareResponse)
async def compare_files(
    org_slug: str = Depends(require_org_slug),
    base_file: UploadFile = _BASE_FILE,
    comparison_file: UploadFile = _COMPARISON_FILE,
    max_changes: int = _MAX_CHANGES_FORM,
):
    """Compare two uploaded files using deterministic paragraph-level diffing.

    Extracts text directly from file bytes — no database indexing or embedding required.
    """
    if not base_file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Base file must have a filename")
    if not comparison_file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Comparison file must have a filename")

    _validate_file_extension(base_file.filename)
    _validate_file_extension(comparison_file.filename)

    base_bytes = await _read_upload_with_size_check(base_file, settings.max_document_size_mb)
    comparison_bytes = await _read_upload_with_size_check(comparison_file, settings.max_document_size_mb)

    try:
        result = await rag_service.compare_files(
            org_slug,
            base_bytes,
            base_file.filename,
            comparison_bytes,
            comparison_file.filename,
            max_changes=max_changes,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(e),
        ) from e
    except Exception as e:
        logger.error("Failed to compare uploaded files: {}", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to compare uploaded files.",
        ) from e

    return DocumentCompareResponse(**result)


@router.post("/documents/statuses", response_model=DocumentStatusResponse)
async def get_document_statuses(
    request: DocumentStatusRequest,
    org_slug: str = Depends(require_org_slug),
):
    """Get statuses for multiple documents by ID, scoped to caller's org.

    Returns status info for each file_id, or null if the file doesn't
    exist in `org_slug` (including IDs that exist for a different org).
    """
    try:
        statuses_raw = await rag_service.get_document_statuses(org_slug, request.file_ids)
        statuses = {
            did: DocumentStatusInfo(
                status=info["status"],
                error=info.get("error"),
                progress_phase=info.get("progress_phase"),
                progress_detail=info.get("progress_detail"),
                source_created_at=info.get("source_created_at"),
                source_modified_at=info.get("source_modified_at"),
                ocr_applied=info.get("ocr_applied"),
            )
            if info
            else None
            for did, info in statuses_raw.items()
        }
        return DocumentStatusResponse(statuses=statuses)
    except Exception as e:
        logger.error("Failed to get document statuses: {}", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to get document statuses.",
        ) from e

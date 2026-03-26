"""Document indexing service for the RAG pipeline.

Handles: extract text -> chunk -> embed -> store in private_knowledge schema.
Content hash dedup: skip if document content hasn't changed.
"""

from __future__ import annotations

import datetime as dt
import re
import uuid
from dataclasses import dataclass, replace
from io import BytesIO
from typing import Any

import asyncpg
from loguru import logger
from tale_knowledge.chunking import ContentChunk, chunk_content
from tale_knowledge.embedding import EmbeddingService
from tale_knowledge.extraction import extract_text
from tale_knowledge.vision import VisionClient
from tale_shared.db import acquire_with_retry
from tale_shared.utils.hashing import compute_content_hash

SCHEMA = "private_knowledge"
_HNSW_INDEX = f"{SCHEMA}.idx_pk_chunks_embedding_hnsw"
_HNSW_CORRUPTION_MARKER = "should be empty but is not"

_PDF_DATE_RE = re.compile(
    r"^(?:D:)?"
    r"(\d{4})"
    r"(\d{2})?"
    r"(\d{2})?"
    r"(\d{2})?"
    r"(\d{2})?"
    r"(\d{2})?"
    r"([Z+\-])?"
    r"(\d{2})?'?"
    r"(\d{2})?'?"
)

_MIN_YEAR = 1970
_MAX_YEAR = 2100


@dataclass(frozen=True, slots=True)
class PreparedDocument:
    """Pre-processed document ready for storage (extract + chunk + embed done once)."""

    content_hash: str
    chunks: list[ContentChunk]
    embeddings: list[list[float]]
    vision_used: bool
    source_created_at: dt.datetime | None = None
    source_modified_at: dt.datetime | None = None


def _parse_pdf_date(date_str: str | None) -> dt.datetime | None:
    """Parse PDF date format ``D:YYYYMMDDHHmmSSOHH'mm'`` to a datetime.

    Returns ``None`` for missing, malformed, or out-of-range dates.
    """
    if not date_str or not isinstance(date_str, str):
        return None

    match = _PDF_DATE_RE.match(date_str.strip())
    if not match:
        return None

    try:
        year = int(match.group(1))
        if year < _MIN_YEAR or year > _MAX_YEAR:
            return None

        month = int(match.group(2) or "01")
        day = int(match.group(3) or "01")
        hour = int(match.group(4) or "00")
        minute = int(match.group(5) or "00")
        second = int(match.group(6) or "00")

        tz_sign = match.group(7)
        tz_hours = int(match.group(8) or "0")
        tz_minutes = int(match.group(9) or "0")

        if tz_sign == "-":
            tz_offset = dt.timezone(dt.timedelta(hours=-tz_hours, minutes=-tz_minutes))
        elif tz_sign == "+":
            tz_offset = dt.timezone(dt.timedelta(hours=tz_hours, minutes=tz_minutes))
        else:
            tz_offset = dt.UTC

        return dt.datetime(year, month, day, hour, minute, second, tzinfo=tz_offset)
    except (ValueError, OverflowError):
        return None


def _ensure_aware(d: dt.datetime | None) -> dt.datetime | None:
    """Ensure a datetime is timezone-aware (assume UTC if naive)."""
    if d is None:
        return None
    if not isinstance(d, dt.datetime):
        return None
    if d.tzinfo is None:
        return d.replace(tzinfo=dt.UTC)
    return d


def _extract_file_dates(
    content_bytes: bytes,
    filename: str,
) -> tuple[dt.datetime | None, dt.datetime | None]:
    """Extract created/modified dates from PDF, DOCX, or PPTX file bytes.

    Returns (created, modified). Both may be None on failure or unsupported format.
    """
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    try:
        if ext == "pdf":
            import fitz

            doc = fitz.open(stream=content_bytes, filetype="pdf")
            metadata = doc.metadata or {}
            doc.close()
            return (
                _parse_pdf_date(metadata.get("creationDate")),
                _parse_pdf_date(metadata.get("modDate")),
            )

        if ext == "docx":
            from docx import Document

            doc = Document(BytesIO(content_bytes))
            props = doc.core_properties
            return (
                _ensure_aware(props.created),
                _ensure_aware(props.modified),
            )

        if ext == "pptx":
            from pptx import Presentation

            prs = Presentation(BytesIO(content_bytes))
            props = prs.core_properties
            return (
                _ensure_aware(props.created),
                _ensure_aware(props.modified),
            )
    except Exception:
        logger.warning("Could not extract dates from {}", filename)

    return (None, None)


async def prepare_document(
    content_bytes: bytes,
    filename: str,
    *,
    embedding_service: EmbeddingService,
    vision_client: VisionClient | None = None,
    chunk_size: int = 2048,
    chunk_overlap: int = 200,
) -> PreparedDocument | None:
    """Extract, chunk, and embed a document (expensive work done once).

    Returns None if no usable text/chunks could be produced.
    """
    content_hash = compute_content_hash(content_bytes)

    try:
        extracted_text, vision_used = await extract_text(
            content_bytes,
            filename,
            vision_client=vision_client,
        )
    except UnicodeDecodeError:
        raise ValueError(
            f"Could not decode file '{filename}'. Supported formats: "
            "PDF, DOCX, PPTX, XLSX, TXT, MD, CSV, PNG, JPG, GIF, WebP"
        ) from None

    source_created_at, source_modified_at = _extract_file_dates(content_bytes, filename)

    if not extracted_text or not extracted_text.strip():
        logger.warning("No text extracted from {}", filename)
        return None

    chunks = chunk_content(
        extracted_text,
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
    )

    if not chunks:
        logger.warning("No chunks produced from {}", filename)
        return None

    embeddings = await embedding_service.embed_texts([c.content for c in chunks])

    return PreparedDocument(
        content_hash=content_hash,
        chunks=chunks,
        embeddings=embeddings,
        vision_used=vision_used,
        source_created_at=source_created_at,
        source_modified_at=source_modified_at,
    )


async def find_existing_by_hash(
    pool: asyncpg.Pool,
    content_hash: str,
) -> uuid.UUID | None:
    """Find a completed document with the given content hash (any scope).

    Returns the internal UUID (documents.id) if found, else None.
    """
    async with acquire_with_retry(pool) as conn:
        row = await conn.fetchrow(
            f"SELECT id FROM {SCHEMA}.documents WHERE content_hash = $1 AND status = 'completed' LIMIT 1",
            content_hash,
        )
    return row["id"] if row else None


async def clone_from_existing(
    pool: asyncpg.Pool,
    source_doc_id: uuid.UUID,
    file_id: str,
    filename: str,
    content_hash: str,
    *,
    source_created_at: dt.datetime | None = None,
    source_modified_at: dt.datetime | None = None,
) -> dict[str, Any] | None:
    """Clone chunks from an existing document into a new scope.

    Skips if the target scope already has the same content hash.
    Falls back to None if the source document no longer exists.
    """
    async with acquire_with_retry(pool) as conn:
        existing = await conn.fetchrow(
            f"SELECT id, content_hash FROM {SCHEMA}.documents WHERE file_id = $1",
            file_id,
        )

    if existing and existing["content_hash"] == content_hash:
        logger.info("Document {} content unchanged, skipping (clone path)", file_id)
        return {
            "success": True,
            "file_id": file_id,
            "chunks_created": 0,
            "skipped": True,
            "skip_reason": "content_unchanged",
        }

    existing_id = existing["id"] if existing else None

    for attempt in range(2):
        try:
            result = await _do_clone(
                pool,
                source_doc_id,
                file_id,
                filename,
                content_hash,
                existing_id,
                source_created_at=source_created_at,
                source_modified_at=source_modified_at,
            )
            if result is None:
                return None
            logger.info(
                "Cloned document {}: {} chunks (from source {})",
                file_id,
                result["chunks_created"],
                source_doc_id,
            )
            return result
        except asyncpg.exceptions.InternalServerError as exc:
            if _HNSW_CORRUPTION_MARKER in str(exc) and attempt == 0:
                await _reindex_chunks_hnsw(pool)
                continue
            raise


async def _do_clone(
    pool: asyncpg.Pool,
    source_doc_id: uuid.UUID,
    file_id: str,
    filename: str,
    content_hash: str,
    existing_id: uuid.UUID | None,
    *,
    source_created_at: dt.datetime | None = None,
    source_modified_at: dt.datetime | None = None,
) -> dict[str, Any] | None:
    """Clone chunks from source document in a single transaction.

    Returns None if the source document has no chunks (e.g. deleted concurrently).
    """
    async with acquire_with_retry(pool) as conn, conn.transaction():
        source = await conn.fetchrow(
            f"""SELECT chunks_count, source_created_at, source_modified_at
                FROM {SCHEMA}.documents WHERE id = $1 AND status = 'completed'""",
            source_doc_id,
        )
        if not source:
            return None

        if existing_id is not None:
            await conn.execute(f"DELETE FROM {SCHEMA}.chunks WHERE document_id = $1", existing_id)
            await conn.execute(f"DELETE FROM {SCHEMA}.documents WHERE id = $1", existing_id)

        doc_row = await conn.fetchrow(
            f"""
            INSERT INTO {SCHEMA}.documents
                (file_id, filename, content_hash, status, chunks_count,
                 source_created_at, source_modified_at)
            VALUES ($1, $2, $3, 'completed', $4, $5, $6)
            RETURNING id
            """,
            file_id,
            filename,
            content_hash,
            source["chunks_count"],
            source_created_at or source["source_created_at"],
            source_modified_at or source["source_modified_at"],
        )
        new_doc_uuid = doc_row["id"]

        chunks_created = await conn.fetchval(
            f"""
            WITH inserted AS (
                INSERT INTO {SCHEMA}.chunks
                    (document_id, chunk_index, chunk_content, content_hash, embedding)
                SELECT $1, chunk_index, chunk_content, content_hash, embedding
                FROM {SCHEMA}.chunks
                WHERE document_id = $2
                RETURNING 1
            )
            SELECT count(*) FROM inserted
            """,
            new_doc_uuid,
            source_doc_id,
        )

    return {
        "success": True,
        "file_id": file_id,
        "chunks_created": chunks_created,
        "skipped": False,
        "skip_reason": None,
    }


async def _reindex_chunks_hnsw(pool: asyncpg.Pool) -> None:
    """Rebuild the HNSW vector index to recover from page corruption."""
    logger.warning("HNSW index corruption detected — rebuilding {}", _HNSW_INDEX)
    async with acquire_with_retry(pool) as conn:
        await conn.execute(f"REINDEX INDEX {_HNSW_INDEX}", timeout=300)
    logger.info("HNSW index rebuild completed")


async def _do_store(
    pool: asyncpg.Pool,
    file_id: str,
    filename: str,
    prepared: PreparedDocument,
    existing_id: uuid.UUID | None,
) -> dict[str, Any]:
    """Execute the delete-old + insert-new DB operations in a single transaction."""
    async with acquire_with_retry(pool) as conn, conn.transaction():
        if existing_id is not None:
            await conn.execute(f"DELETE FROM {SCHEMA}.chunks WHERE document_id = $1", existing_id)
            await conn.execute(f"DELETE FROM {SCHEMA}.documents WHERE id = $1", existing_id)

        doc_row = await conn.fetchrow(
            f"""
                INSERT INTO {SCHEMA}.documents
                    (file_id, filename, content_hash, status, chunks_count,
                     source_created_at, source_modified_at)
                VALUES ($1, $2, $3, 'completed', $4, $5, $6)
                RETURNING id
                """,
            file_id,
            filename,
            prepared.content_hash,
            len(prepared.chunks),
            prepared.source_created_at,
            prepared.source_modified_at,
        )
        doc_uuid = doc_row["id"]

        chunk_rows = [
            (
                doc_uuid,
                chunk.index,
                chunk.content,
                compute_content_hash(chunk.content.encode("utf-8")),
                str(embedding),
            )
            for chunk, embedding in zip(prepared.chunks, prepared.embeddings, strict=True)
        ]
        await conn.executemany(
            f"""
                INSERT INTO {SCHEMA}.chunks
                    (document_id, chunk_index, chunk_content,
                     content_hash, embedding)
                VALUES ($1, $2, $3, $4, $5::vector)
                """,
            chunk_rows,
        )

    return {
        "success": True,
        "file_id": file_id,
        "chunks_created": len(prepared.chunks),
        "skipped": False,
        "skip_reason": None,
    }


async def store_prepared_document(
    pool: asyncpg.Pool,
    file_id: str,
    filename: str,
    prepared: PreparedDocument,
) -> dict[str, Any]:
    """Store a pre-processed document.

    Handles dedup check, old-version replacement, and HNSW index self-healing.
    """
    async with acquire_with_retry(pool) as conn:
        existing = await conn.fetchrow(
            f"SELECT id, content_hash FROM {SCHEMA}.documents WHERE file_id = $1",
            file_id,
        )

    if existing and existing["content_hash"] == prepared.content_hash:
        logger.info("Document {} content unchanged, skipping", file_id)
        return {
            "success": True,
            "file_id": file_id,
            "chunks_created": 0,
            "skipped": True,
            "skip_reason": "content_unchanged",
        }

    if existing:
        logger.info("Document {} content changed, replacing", file_id)

    existing_id = existing["id"] if existing else None

    for attempt in range(2):
        try:
            result = await _do_store(
                pool,
                file_id,
                filename,
                prepared,
                existing_id,
            )
            logger.info(
                "Indexed document {}: {} chunks",
                file_id,
                result["chunks_created"],
            )
            return result
        except asyncpg.exceptions.InternalServerError as exc:
            if _HNSW_CORRUPTION_MARKER in str(exc) and attempt == 0:
                await _reindex_chunks_hnsw(pool)
                continue
            raise


async def index_document(
    pool: asyncpg.Pool,
    file_id: str,
    content_bytes: bytes,
    filename: str,
    *,
    embedding_service: EmbeddingService,
    vision_client: VisionClient | None = None,
    chunk_size: int = 2048,
    chunk_overlap: int = 200,
    source_created_at: dt.datetime | None = None,
    source_modified_at: dt.datetime | None = None,
) -> dict[str, Any]:
    """Index a document: extract, chunk, embed, and store.

    Attempts content-hash dedup first: if another document already has the same
    content, clone its chunks instead of re-extracting/embedding.
    """
    content_hash = compute_content_hash(content_bytes)
    source_id = await find_existing_by_hash(pool, content_hash)

    if source_id is not None:
        result = await clone_from_existing(
            pool,
            source_id,
            file_id,
            filename,
            content_hash,
            source_created_at=source_created_at,
            source_modified_at=source_modified_at,
        )
        if result is not None:
            return result
        logger.warning("Clone source {} vanished, falling back to full processing", source_id)

    prepared = await prepare_document(
        content_bytes,
        filename,
        embedding_service=embedding_service,
        vision_client=vision_client,
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
    )

    if prepared is None:
        return {
            "success": True,
            "file_id": file_id,
            "chunks_created": 0,
            "skipped": True,
            "skip_reason": "no_text_extracted",
        }

    if source_created_at is not None or source_modified_at is not None:
        prepared = replace(
            prepared,
            source_created_at=source_created_at or prepared.source_created_at,
            source_modified_at=source_modified_at or prepared.source_modified_at,
        )

    return await store_prepared_document(
        pool,
        file_id,
        filename,
        prepared,
    )

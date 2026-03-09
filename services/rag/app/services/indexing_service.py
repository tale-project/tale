"""Document indexing service for the RAG pipeline.

Handles: extract text -> chunk -> embed -> store in private_knowledge schema.
Content hash dedup: skip if document content hasn't changed.
"""

from __future__ import annotations

from dataclasses import dataclass
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


@dataclass(frozen=True, slots=True)
class PreparedDocument:
    """Pre-processed document ready for storage (extract + chunk + embed done once)."""

    content_hash: str
    chunks: list[ContentChunk]
    embeddings: list[list[float]]
    vision_used: bool


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
    )


async def find_existing_by_hash(
    pool: asyncpg.Pool,
    content_hash: str,
) -> int | None:
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
    source_doc_id: int,
    document_id: str,
    filename: str,
    content_hash: str,
    *,
    user_id: str | None = None,
) -> dict[str, Any]:
    """Clone chunks from an existing document into a new scope.

    Skips if the target scope already has the same content hash.
    Falls back to None if the source document no longer exists.
    """
    async with acquire_with_retry(pool) as conn:
        existing = await conn.fetchrow(
            f"""
            SELECT id, content_hash FROM {SCHEMA}.documents
            WHERE document_id = $1
              AND COALESCE(user_id, '') = COALESCE($2, '')
            """,
            document_id,
            user_id,
        )

    if existing and existing["content_hash"] == content_hash:
        logger.info("Document {} content unchanged for user={}, skipping (clone path)", document_id, user_id)
        return {
            "success": True,
            "document_id": document_id,
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
                document_id,
                filename,
                content_hash,
                existing_id,
                user_id=user_id,
            )
            if result is None:
                return None  # type: ignore[return-value]
            logger.info(
                "Cloned document {}: {} chunks for user={} (from source {})",
                document_id,
                result["chunks_created"],
                user_id,
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
    source_doc_id: int,
    document_id: str,
    filename: str,
    content_hash: str,
    existing_id: int | None,
    *,
    user_id: str | None = None,
) -> dict[str, Any] | None:
    """Clone chunks from source document in a single transaction.

    Returns None if the source document has no chunks (e.g. deleted concurrently).
    """
    async with acquire_with_retry(pool) as conn, conn.transaction():
        source = await conn.fetchrow(
            f"SELECT chunks_count FROM {SCHEMA}.documents WHERE id = $1 AND status = 'completed'",
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
                (document_id, filename, content_hash, user_id, status, chunks_count)
            VALUES ($1, $2, $3, $4, 'completed', $5)
            RETURNING id
            """,
            document_id,
            filename,
            content_hash,
            user_id,
            source["chunks_count"],
        )
        new_doc_uuid = doc_row["id"]

        chunks_created = await conn.fetchval(
            f"""
            WITH inserted AS (
                INSERT INTO {SCHEMA}.chunks
                    (document_id, user_id, chunk_index, chunk_content, content_hash, embedding)
                SELECT $1, $2, chunk_index, chunk_content, content_hash, embedding
                FROM {SCHEMA}.chunks
                WHERE document_id = $3
                RETURNING 1
            )
            SELECT count(*) FROM inserted
            """,
            new_doc_uuid,
            user_id,
            source_doc_id,
        )

    return {
        "success": True,
        "document_id": document_id,
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
    document_id: str,
    filename: str,
    prepared: PreparedDocument,
    existing_id: int | None,
    *,
    user_id: str | None = None,
) -> dict[str, Any]:
    """Execute the delete-old + insert-new DB operations in a single transaction."""
    async with acquire_with_retry(pool) as conn, conn.transaction():
        if existing_id is not None:
            await conn.execute(f"DELETE FROM {SCHEMA}.chunks WHERE document_id = $1", existing_id)
            await conn.execute(f"DELETE FROM {SCHEMA}.documents WHERE id = $1", existing_id)

        doc_row = await conn.fetchrow(
            f"""
                INSERT INTO {SCHEMA}.documents
                    (document_id, filename, content_hash, user_id, status, chunks_count)
                VALUES ($1, $2, $3, $4, 'completed', $5)
                RETURNING id
                """,
            document_id,
            filename,
            prepared.content_hash,
            user_id,
            len(prepared.chunks),
        )
        doc_uuid = doc_row["id"]

        chunk_rows = [
            (
                doc_uuid,
                user_id,
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
                    (document_id, user_id, chunk_index, chunk_content,
                     content_hash, embedding)
                VALUES ($1, $2, $3, $4, $5, $6::vector)
                """,
            chunk_rows,
        )

    return {
        "success": True,
        "document_id": document_id,
        "chunks_created": len(prepared.chunks),
        "skipped": False,
        "skip_reason": None,
    }


async def store_prepared_document(
    pool: asyncpg.Pool,
    document_id: str,
    filename: str,
    prepared: PreparedDocument,
    *,
    user_id: str | None = None,
) -> dict[str, Any]:
    """Store a pre-processed document.

    Handles dedup check, old-version replacement, and HNSW index self-healing.
    """
    async with acquire_with_retry(pool) as conn:
        existing = await conn.fetchrow(
            f"""
            SELECT id, content_hash FROM {SCHEMA}.documents
            WHERE document_id = $1
              AND COALESCE(user_id, '') = COALESCE($2, '')
            """,
            document_id,
            user_id,
        )

    if existing and existing["content_hash"] == prepared.content_hash:
        logger.info("Document {} content unchanged for user={}, skipping", document_id, user_id)
        return {
            "success": True,
            "document_id": document_id,
            "chunks_created": 0,
            "skipped": True,
            "skip_reason": "content_unchanged",
        }

    if existing:
        logger.info("Document {} content changed, replacing for user={}", document_id, user_id)

    existing_id = existing["id"] if existing else None

    for attempt in range(2):
        try:
            result = await _do_store(
                pool,
                document_id,
                filename,
                prepared,
                existing_id,
                user_id=user_id,
            )
            logger.info(
                "Indexed document {}: {} chunks for user={}",
                document_id,
                result["chunks_created"],
                user_id,
            )
            return result
        except asyncpg.exceptions.InternalServerError as exc:
            if _HNSW_CORRUPTION_MARKER in str(exc) and attempt == 0:
                await _reindex_chunks_hnsw(pool)
                continue
            raise


async def index_document(
    pool: asyncpg.Pool,
    document_id: str,
    content_bytes: bytes,
    filename: str,
    *,
    user_id: str | None = None,
    embedding_service: EmbeddingService,
    vision_client: VisionClient | None = None,
    chunk_size: int = 2048,
    chunk_overlap: int = 200,
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
            document_id,
            filename,
            content_hash,
            user_id=user_id,
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
            "document_id": document_id,
            "chunks_created": 0,
            "skipped": True,
            "skip_reason": "no_text_extracted",
        }

    return await store_prepared_document(
        pool,
        document_id,
        filename,
        prepared,
        user_id=user_id,
    )

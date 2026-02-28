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


async def store_prepared_document(
    pool: asyncpg.Pool,
    document_id: str,
    filename: str,
    prepared: PreparedDocument,
    *,
    team_id: str | None = None,
    user_id: str | None = None,
) -> dict[str, Any]:
    """Store a pre-processed document for a single tenant scope.

    Handles dedup check and old-version replacement.
    """
    async with acquire_with_retry(pool) as conn:
        existing = await conn.fetchrow(
            f"""
            SELECT id, content_hash FROM {SCHEMA}.documents
            WHERE document_id = $1
              AND COALESCE(team_id, '') = COALESCE($2, '')
              AND COALESCE(user_id, '') = COALESCE($3, '')
            """,
            document_id,
            team_id,
            user_id,
        )

    if existing and existing["content_hash"] == prepared.content_hash:
        logger.info("Document {} content unchanged for team={} user={}, skipping", document_id, team_id, user_id)
        return {
            "success": True,
            "document_id": document_id,
            "chunks_created": 0,
            "skipped": True,
            "skip_reason": "content_unchanged",
        }

    if existing:
        logger.info("Document {} content changed, replacing for team={} user={}", document_id, team_id, user_id)
        async with acquire_with_retry(pool) as conn, conn.transaction():
            await conn.execute(f"DELETE FROM {SCHEMA}.chunks WHERE document_id = $1", existing["id"])
            await conn.execute(f"DELETE FROM {SCHEMA}.documents WHERE id = $1", existing["id"])

    async with acquire_with_retry(pool) as conn, conn.transaction():
        doc_row = await conn.fetchrow(
            f"""
                INSERT INTO {SCHEMA}.documents
                    (document_id, filename, content_hash, team_id, user_id, status, chunks_count)
                VALUES ($1, $2, $3, $4, $5, 'completed', $6)
                RETURNING id
                """,
            document_id,
            filename,
            prepared.content_hash,
            team_id,
            user_id,
            len(prepared.chunks),
        )
        doc_uuid = doc_row["id"]

        chunk_rows = [
            (
                doc_uuid,
                team_id,
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
                    (document_id, team_id, user_id, chunk_index, chunk_content,
                     content_hash, embedding)
                VALUES ($1, $2, $3, $4, $5, $6, $7::vector)
                """,
            chunk_rows,
        )

    logger.info(
        "Indexed document {}: {} chunks for team={} user={}",
        document_id,
        len(prepared.chunks),
        team_id,
        user_id,
    )

    return {
        "success": True,
        "document_id": document_id,
        "chunks_created": len(prepared.chunks),
        "skipped": False,
        "skip_reason": None,
    }


async def index_document(
    pool: asyncpg.Pool,
    document_id: str,
    content_bytes: bytes,
    filename: str,
    *,
    team_id: str | None = None,
    user_id: str | None = None,
    embedding_service: EmbeddingService,
    vision_client: VisionClient | None = None,
    chunk_size: int = 2048,
    chunk_overlap: int = 200,
) -> dict[str, Any]:
    """Index a document: extract, chunk, embed, and store (single-tenant shortcut)."""
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
        team_id=team_id,
        user_id=user_id,
    )

"""Document indexing service for the RAG pipeline.

Handles: extract text -> chunk -> embed -> store in private_knowledge schema.
Content hash dedup: skip if document content hasn't changed.
"""

from __future__ import annotations

from typing import Any

import asyncpg
from loguru import logger

from tale_knowledge.chunking import chunk_content
from tale_knowledge.embedding import EmbeddingService
from tale_knowledge.extraction import extract_text
from tale_knowledge.vision import VisionClient
from tale_shared.utils.hashing import compute_content_hash

from tale_shared.db import acquire_with_retry

SCHEMA = "private_knowledge"


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
    chunk_size: int = 512,
    chunk_overlap: int = 50,
) -> dict[str, Any]:
    """Index a document: extract, chunk, embed, and store.

    Args:
        pool: asyncpg connection pool.
        document_id: Caller-assigned document identifier.
        content_bytes: Raw file bytes.
        filename: Original filename (used for routing extraction).
        team_id: Optional team for tenant isolation.
        user_id: Optional user for tenant isolation.
        embedding_service: EmbeddingService instance.
        vision_client: Optional VisionClient for OCR/images.
        chunk_size: Target chunk size in characters.
        chunk_overlap: Overlap between chunks in characters.

    Returns:
        Dict with success, document_id, chunks_created, skipped, skip_reason.
    """
    content_hash = compute_content_hash(content_bytes)

    # Dedup check: same document_id + team_id/user_id + same content hash
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

    if existing and existing["content_hash"] == content_hash:
        logger.info("Document {} content unchanged, skipping", document_id)
        return {
            "success": True,
            "document_id": document_id,
            "chunks_created": 0,
            "skipped": True,
            "skip_reason": "content_unchanged",
        }

    # If content changed, delete old version (CASCADE deletes chunks)
    if existing:
        logger.info("Document {} content changed, replacing", document_id)
        async with acquire_with_retry(pool) as conn:
            await conn.execute(f"DELETE FROM {SCHEMA}.documents WHERE id = $1", existing["id"])

    # Extract text
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
        return {
            "success": True,
            "document_id": document_id,
            "chunks_created": 0,
            "skipped": True,
            "skip_reason": "no_text_extracted",
        }

    # Chunk
    chunks = chunk_content(
        extracted_text,
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
    )

    if not chunks:
        logger.warning("No chunks produced from {}", filename)
        return {
            "success": True,
            "document_id": document_id,
            "chunks_created": 0,
            "skipped": True,
            "skip_reason": "no_chunks_produced",
        }

    # Embed
    embeddings = await embedding_service.embed_texts([c.content for c in chunks])

    # Store in single transaction
    async with acquire_with_retry(pool) as conn:
        async with conn.transaction():
            doc_row = await conn.fetchrow(
                f"""
                INSERT INTO {SCHEMA}.documents
                    (document_id, filename, content_hash, team_id, user_id, status, chunks_count)
                VALUES ($1, $2, $3, $4, $5, 'completed', $6)
                RETURNING id
                """,
                document_id,
                filename,
                content_hash,
                team_id,
                user_id,
                len(chunks),
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
                for chunk, embedding in zip(chunks, embeddings, strict=True)
            ]
            await conn.executemany(
                f"""
                INSERT INTO {SCHEMA}.chunks
                    (document_id, team_id, user_id, chunk_index, chunk_content,
                     content_hash, embedding)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                """,
                chunk_rows,
            )

    logger.info("Indexed document {}: {} chunks, vision_used={}", document_id, len(chunks), vision_used)

    return {
        "success": True,
        "document_id": document_id,
        "chunks_created": len(chunks),
        "skipped": False,
        "skip_reason": None,
    }

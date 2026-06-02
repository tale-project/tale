"""Postgres -> external-backend vector copy.

When the deployment switches to an external backend (e.g. Qdrant), the
embedding vectors already live in `chunks.embedding` — no re-embedding is
needed, just a copy. This streams chunk vectors out of Postgres in
keyset-paginated batches and upserts them into the active store.

Idempotent: upsert keys on chunk id, so re-running reconciles drift
(e.g. a Postgres write that committed before its external upsert).
"""

from __future__ import annotations

import json

import asyncpg
from loguru import logger
from tale_shared.db import acquire_with_retry

from .base import VectorRecord, VectorStore

SCHEMA = "private_knowledge"
_BATCH = 500


async def backfill_vectors(
    pool: asyncpg.Pool,
    store: VectorStore,
    *,
    batch_size: int = _BATCH,
) -> int:
    """Copy every `chunks.embedding` vector into `store`. Returns the count.

    Reads `embedding::text` so the pgvector column round-trips as a JSON
    array regardless of whether an asyncpg vector codec is registered.
    """
    copied = 0
    last_id = None
    while True:
        rows = await _fetch_batch(pool, last_id, batch_size)
        if not rows:
            break
        records = [
            VectorRecord(
                chunk_id=r["id"],
                org_slug=r["org_slug"],
                document_id=r["document_id"],
                embedding=json.loads(r["embedding"]),
            )
            for r in rows
        ]
        await store.upsert(records)
        copied += len(records)
        last_id = rows[-1]["id"]
        logger.info("Vector backfill: {} copied so far", copied)

    logger.info("Vector backfill complete: {} vectors copied to {}", copied, store.backend_name)
    return copied


async def _fetch_batch(
    pool: asyncpg.Pool,
    last_id: object | None,
    batch_size: int,
) -> list[asyncpg.Record]:
    if last_id is None:
        sql = f"""
            SELECT id, org_slug, document_id, embedding::text AS embedding
            FROM {SCHEMA}.chunks
            WHERE embedding IS NOT NULL
            ORDER BY id
            LIMIT $1
        """
        params: list[object] = [batch_size]
    else:
        sql = f"""
            SELECT id, org_slug, document_id, embedding::text AS embedding
            FROM {SCHEMA}.chunks
            WHERE embedding IS NOT NULL AND id > $1
            ORDER BY id
            LIMIT $2
        """
        params = [last_id, batch_size]
    async with acquire_with_retry(pool) as conn:
        return await conn.fetch(sql, *params)

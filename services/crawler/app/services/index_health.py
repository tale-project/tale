"""Chunks table index health: detect corruption and rebuild."""

import asyncpg
from loguru import logger
from tale_shared.db import acquire_with_retry

SCHEMA = "public_web"
_BM25_INDEX = f"{SCHEMA}.idx_pw_chunks_bm25"
_HNSW_INDEX = f"{SCHEMA}.idx_pw_chunks_embedding_hnsw"


async def reindex_chunks(pool: asyncpg.Pool) -> None:
    """Rebuild BM25 and HNSW indexes on public_web.chunks.

    REINDEX cannot run inside a transaction, so each index is rebuilt
    separately on a bare connection.  Uses plain REINDEX (not CONCURRENTLY)
    since this runs after bulk deletes or during error recovery where
    correctness matters more than availability.
    """
    async with acquire_with_retry(pool) as conn:
        for index in (_BM25_INDEX, _HNSW_INDEX):
            try:
                await conn.execute(f"REINDEX INDEX {index}", timeout=300)
                logger.info("Rebuilt index: {}", index)
            except asyncpg.UndefinedObjectError:
                logger.debug("Index {} does not exist, skipping", index)
            except Exception as e:
                logger.error("Failed to rebuild {}: {}", index, e)


async def check_and_repair_chunks_index(pool: asyncpg.Pool) -> None:
    """Startup health check: probe chunks indexes and repair if corrupted."""
    try:
        async with acquire_with_retry(pool) as conn:
            await conn.execute("SET LOCAL statement_timeout = '10s'")
            await conn.fetchval(f"SELECT COUNT(*) FROM {SCHEMA}.chunks LIMIT 1")
        logger.info("Chunks index health check passed")
    except Exception as e:
        logger.warning("Chunks index health check failed ({}), rebuilding indexes", e)
        await reindex_chunks(pool)

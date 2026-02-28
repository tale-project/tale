"""
Async PostgreSQL connection pool using asyncpg.

Provides a singleton pool tied to FastAPI's lifespan for the tale_search database.
"""

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import asyncpg
import stamina
from loguru import logger

from app.config import settings

_pool: asyncpg.Pool | None = None


def _get_database_url() -> str:
    if settings.database_url:
        return settings.database_url
    if url := os.environ.get("DATABASE_URL"):
        return url
    password = os.environ.get("DB_PASSWORD", "tale_password_change_me")
    return f"postgresql://tale:{password}@db:5432/tale_search"


async def init_pool(*, max_size: int = 10) -> asyncpg.Pool:
    global _pool
    if _pool is not None:
        return _pool

    dsn = _get_database_url()
    _pool = await asyncpg.create_pool(dsn, min_size=min(2, max_size), max_size=max_size)
    logger.info(f"PostgreSQL connection pool initialized (min={min(2, max_size)}, max={max_size})")

    # Guard against embedding dimension mismatch: if existing data uses a
    # different dimension than the current config, refuse to start.
    configured_dims = settings.get_embedding_dimensions()
    async with _pool.acquire() as conn:
        stored_dims = await conn.fetchval(
            "SELECT vector_dims(embedding) FROM chunks WHERE embedding IS NOT NULL LIMIT 1"
        )
    if stored_dims is not None and stored_dims != configured_dims:
        await _pool.close()
        _pool = None
        raise RuntimeError(
            f"Embedding dimension mismatch: database has {stored_dims}d vectors "
            f"but CRAWLER_EMBEDDING_DIMENSIONS={configured_dims}. "
            f"Re-index existing data or update the config to match."
        )

    # Pin the embedding column to explicit dimensions so HNSW indexes work.
    # The column starts as untyped `vector` because dimensions are configurable;
    # once we know the configured value we can lock it in.  If the column was
    # previously pinned to a different dimension (e.g. config changed while the
    # table was empty), re-pin it — the mismatch guard above already ensures any
    # existing data is compatible.
    expected_type = f"vector({int(configured_dims)})"
    async with _pool.acquire() as conn:
        col_type = await conn.fetchval(
            "SELECT format_type(atttypid, atttypmod) "
            "FROM pg_attribute "
            "WHERE attrelid = 'chunks'::regclass AND attname = 'embedding'"
        )
        if col_type != expected_type:
            await conn.execute("DROP INDEX IF EXISTS idx_chunks_embedding_hnsw")
            await conn.execute(f"ALTER TABLE chunks ALTER COLUMN embedding TYPE vector({int(configured_dims)})")
            logger.info(f"Pinned embedding column to vector({configured_dims}) (was {col_type})")

    # Create HNSW index if it doesn't exist yet.
    try:
        async with _pool.acquire() as conn:
            await conn.execute("SELECT create_chunks_hnsw_index()")
    except Exception as e:
        logger.warning(f"HNSW index creation deferred: {e}")

    return _pool


_TRANSIENT_ERRORS = (asyncpg.CannotConnectNowError, OSError)


@asynccontextmanager
async def acquire_with_retry(pool: asyncpg.Pool) -> AsyncIterator[asyncpg.Connection]:
    """Acquire a pooled connection, retrying on transient DB errors."""
    async for attempt in stamina.retry_context(
        on=_TRANSIENT_ERRORS,
        attempts=5,
        timeout=30,
    ):
        with attempt:
            conn = await pool.acquire()
    try:
        yield conn
    finally:
        await pool.release(conn)


def get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("Database pool not initialized. Call init_pool() first.")
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
        logger.info("PostgreSQL connection pool closed")

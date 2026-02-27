"""
Async PostgreSQL connection pool using asyncpg.

Provides a singleton pool tied to FastAPI's lifespan for the tale_crawler_search database.
"""

import os

import asyncpg
from loguru import logger

from app.config import settings

_pool: asyncpg.Pool | None = None


def _get_database_url() -> str:
    if settings.database_url:
        return settings.database_url
    if url := os.environ.get("DATABASE_URL"):
        return url
    password = os.environ.get("DB_PASSWORD", "tale_password_change_me")
    return f"postgresql://tale:{password}@db:5432/tale_crawler_search"


async def init_pool() -> asyncpg.Pool:
    global _pool
    if _pool is not None:
        return _pool

    dsn = _get_database_url()
    _pool = await asyncpg.create_pool(dsn, min_size=5, max_size=25)
    logger.info("PostgreSQL connection pool initialized")

    # Create HNSW index if embeddings exist but index doesn't.
    # May fail when embedding column has no dimension yet (empty table).
    try:
        async with _pool.acquire() as conn:
            await conn.execute("SELECT create_chunks_hnsw_index()")
    except Exception as e:
        logger.warning(f"HNSW index creation deferred: {e}")

    return _pool


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

"""
Async PostgreSQL connection pool using asyncpg.

Provides a singleton pool tied to FastAPI's lifespan for the tale_knowledge database
(public_web schema for crawler data).
"""

import asyncio
import json
import os

import asyncpg
from loguru import logger
from tale_shared.db import acquire_with_retry

from app.config import settings

SCHEMA = "public_web"

_pool: asyncpg.Pool | None = None
_pool_lock = asyncio.Lock()


def _get_database_url() -> str:
    if settings.database_url:
        return settings.database_url
    if url := os.environ.get("DATABASE_URL"):
        return url
    password = os.environ.get("DB_PASSWORD")
    if not password:
        raise ValueError("DB_PASSWORD environment variable is required")
    return f"postgresql://tale:{password}@db:5432/tale_knowledge"


async def _init_connection(conn: asyncpg.Connection):
    """Register JSONB codec so asyncpg returns dicts instead of raw strings."""
    await conn.set_type_codec("jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")


async def init_pool(*, max_size: int = 10) -> asyncpg.Pool:
    global _pool
    if _pool is not None:
        return _pool

    async with _pool_lock:
        if _pool is not None:
            return _pool

        dsn = _get_database_url()
        _pool = await asyncpg.create_pool(
            dsn,
            min_size=min(2, max_size),
            max_size=max_size,
            max_inactive_connection_lifetime=120.0,
            server_settings={
                "search_path": f"{SCHEMA},public",
                "tcp_keepalives_idle": "60",
                "tcp_keepalives_interval": "10",
                "tcp_keepalives_count": "3",
            },
            init=_init_connection,
        )
        logger.info(f"PostgreSQL connection pool initialized (min={min(2, max_size)}, max={max_size})")

        # Note: the previous boot-time embedding-dimension guard was
        # removed when crawler became multi-org. Dim is now an attribute
        # of the org's provider catalog, not a global setting, and there
        # is no org context at lifespan start. `get_embedding_service()`
        # refuses dim changes per-org at request time; pgvector enforces
        # column dim on insert.
        #
        # The column type and HNSW index are pinned lazily on the first
        # insert (pgvector errors loudly on dim mismatch). All orgs
        # sharing this crawler instance must agree on embedding dims.

        # Create HNSW index if it doesn't exist yet. The index targets
        # whatever the column type is set to; if no rows have been
        # inserted, the call is cheap.
        try:
            async with acquire_with_retry(_pool) as conn:
                await conn.execute(f"SELECT {SCHEMA}.create_chunks_hnsw_index()")
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

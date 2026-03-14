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

        # Guard against embedding dimension mismatch: if existing data uses a
        # different dimension than the current config, refuse to start.
        configured_dims = settings.get_embedding_dimensions()
        async with acquire_with_retry(_pool) as conn:
            stored_dims = await conn.fetchval(
                f"SELECT vector_dims(embedding) FROM {SCHEMA}.chunks WHERE embedding IS NOT NULL LIMIT 1"
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
        expected_type = f"vector({int(configured_dims)})"
        async with acquire_with_retry(_pool) as conn:
            col_type = await conn.fetchval(
                "SELECT format_type(atttypid, atttypmod) "
                "FROM pg_attribute "
                "WHERE attrelid = $1::regclass AND attname = 'embedding'",
                f"{SCHEMA}.chunks",
            )
            if col_type != expected_type:
                await conn.execute(f"DROP INDEX IF EXISTS {SCHEMA}.idx_pw_chunks_embedding_hnsw")
                await conn.execute(
                    f"ALTER TABLE {SCHEMA}.chunks ALTER COLUMN embedding TYPE vector({int(configured_dims)})"
                )
                logger.info(f"Pinned embedding column to vector({configured_dims}) (was {col_type})")

        # Create HNSW index if it doesn't exist yet.
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

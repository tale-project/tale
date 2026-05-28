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

        # Resolve the deployment-wide embedding dim BEFORE creating the
        # pool. This way, a missing `default` org provider fails fast
        # with no pool resource to clean up — and the module-level
        # `_pool` stays None so a follow-up retry can re-enter cleanly.
        #
        # Background: the baseline migration declares `embedding vector`
        # (no dim) so pgvector accepts mixed-dim inserts silently and
        # `create_chunks_hnsw_index()` raises ("has no dimensions").
        # All orgs on this deployment must share embedding dims (single
        # chunks table); we pin from the `default` org's catalog.
        try:
            _, _, _, dims = settings.get_embedding_config("default")
        except Exception as e:
            raise RuntimeError(
                "Cannot resolve embedding dims for the 'default' org "
                "(needed to pin public_web.chunks.embedding at boot). "
                "Ensure providers are configured for the default org "
                "before starting crawler."
            ) from e

        dsn = _get_database_url()
        pool = await asyncpg.create_pool(
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

        try:
            async with acquire_with_retry(pool) as conn:
                await conn.execute(f"ALTER TABLE {SCHEMA}.chunks ALTER COLUMN embedding TYPE vector({dims})")
            logger.info(f"Pinned {SCHEMA}.chunks.embedding to vector({dims})")

            # Create HNSW index if it doesn't exist yet. After the pin
            # above this is the normal path; the function raises if the
            # dim is still unset, which would now indicate a deeper
            # invariant break.
            try:
                async with acquire_with_retry(pool) as conn:
                    await conn.execute(f"SELECT {SCHEMA}.create_chunks_hnsw_index()")
            except Exception as e:
                logger.warning(f"HNSW index creation deferred: {e}")
        except Exception:
            # Roll back the pool we just opened so a retry hits a clean state.
            await pool.close()
            raise

        _pool = pool
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

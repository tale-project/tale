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

# Dimensionality of `public_web.chunks.embedding` after `init_pool`
# finishes. Resolved from the `default` org's embedding-model config at
# boot; all subsequent per-org client builds in `embedding_service.py`
# MUST validate against this value (P1-27) — a per-org provider config
# that disagrees would silently succeed at config-load and crash only
# at INSERT/search time with a cryptic pgvector cast error.
BOOT_PINNED_DIMS: int | None = None


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
                # Pre-check: read the current column type. format_type
                # returns `vector` (no dim) on a fresh baseline,
                # `vector(N)` once pinned. If it's already pinned to a
                # different N, the historical "ALTER unconditionally"
                # would either (a) raise a cryptic pgvector cast error
                # mid-startup, or (b) silently re-pin and orphan stored
                # vectors. Surface a legible message instead and refuse
                # to continue. Round-2 P1-24 restoration.
                col_type = await conn.fetchval(
                    "SELECT format_type(atttypid, atttypmod) "
                    "FROM pg_attribute "
                    "WHERE attrelid = $1::regclass AND attname = 'embedding'",
                    f"{SCHEMA}.chunks",
                )
                if isinstance(col_type, str) and col_type.startswith("vector(") and col_type != f"vector({dims})":
                    raise RuntimeError(
                        f"Embedding dimension mismatch: {SCHEMA}.chunks.embedding "
                        f"is {col_type} but the 'default' org's provider config "
                        f"requests vector({dims}). Either reconcile the provider "
                        f"catalog to match the existing column dimension, or "
                        f"restore the database from a backup taken before the "
                        f"dimension change."
                    )

                # Only ALTER when needed (column is dimensionless OR
                # we just verified it matches). Avoids the AccessExclusiveLock
                # on the chunks table every boot.
                if col_type != f"vector({dims})":
                    await conn.execute(f"ALTER TABLE {SCHEMA}.chunks ALTER COLUMN embedding TYPE vector({dims})")
                    logger.info(f"Pinned {SCHEMA}.chunks.embedding to vector({dims})")
                else:
                    logger.info(f"{SCHEMA}.chunks.embedding already pinned to vector({dims}); skipping ALTER")

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

        # Record the boot-pinned dim AFTER all guards pass so per-org
        # embedding-service builds can validate against this single
        # source of truth (P1-27).
        global BOOT_PINNED_DIMS
        BOOT_PINNED_DIMS = dims
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

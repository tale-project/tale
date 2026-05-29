"""PostgreSQL connection pool for the RAG service.

Connects to the tale_knowledge database with search_path set to
private_knowledge schema. Handles embedding dimension validation
and HNSW index creation at startup.
"""

import asyncio

import asyncpg
from loguru import logger
from tale_shared.db import acquire_with_retry

from ..config import settings

_pool: asyncpg.Pool | None = None
_pool_lock = asyncio.Lock()

SCHEMA = "private_knowledge"


async def init_pool() -> asyncpg.Pool:
    """Initialize the asyncpg connection pool.

    Returns the pool for use by other services.
    """
    global _pool
    if _pool is not None:
        return _pool

    async with _pool_lock:
        if _pool is not None:
            return _pool

        db_url = settings.get_database_url()
        _pool = await asyncpg.create_pool(
            db_url,
            min_size=settings.database_pool_min,
            max_size=settings.database_pool_max,
            command_timeout=30,
            max_inactive_connection_lifetime=120.0,
            server_settings={
                "search_path": f"{SCHEMA},public",
                "tcp_keepalives_idle": "60",
                "tcp_keepalives_interval": "10",
                "tcp_keepalives_count": "3",
            },
        )
        logger.info("Created connection pool for {} schema", SCHEMA)
        return _pool


async def get_pool() -> asyncpg.Pool:
    if _pool is None:
        return await init_pool()
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        try:
            await _pool.close()
        finally:
            _pool = None
        logger.info("Closed RAG database connection pool")


async def pin_embedding_dimensions(pool: asyncpg.Pool, dimensions: int) -> None:
    """Pin the embedding column to explicit dimensions and create HNSW index.

    This is a runtime convergence step (not a migration) because the target
    dimensions depend on the configured embedding model, which can vary between
    deployments. Schema migrations are handled by dbmate in services/db/migrations/.
    """
    async with acquire_with_retry(pool) as conn:
        try:
            col_type = await conn.fetchval(
                """
                SELECT format_type(atttypid, atttypmod)
                FROM pg_attribute
                WHERE attrelid = $1::regclass AND attname = 'embedding'
                """,
                f"{SCHEMA}.chunks",
            )
        except asyncpg.exceptions.UndefinedTableError:
            logger.warning("{}.chunks table does not exist yet, skipping dimension check", SCHEMA)
            return

        expected_type = f"vector({dimensions})"

        if col_type == "vector":
            logger.info("Pinning {}.chunks.embedding to vector({})", SCHEMA, dimensions)
            await conn.execute(f"ALTER TABLE {SCHEMA}.chunks ALTER COLUMN embedding TYPE vector({dimensions})")
        elif col_type != expected_type:
            logger.warning(
                "Embedding column is {}, expected {}. Dimension mismatch — existing embeddings may need re-generation.",
                col_type,
                expected_type,
            )
            await conn.execute(f"ALTER TABLE {SCHEMA}.chunks ALTER COLUMN embedding TYPE vector({dimensions})")
        else:
            logger.info("Embedding column already pinned to {}", expected_type)

        try:
            await conn.execute(f"SELECT {SCHEMA}.create_chunks_hnsw_index()")
            logger.info("HNSW index ensured")
        except asyncpg.exceptions.ProgramLimitExceededError:
            logger.warning(
                "Cannot create HNSW index: {} dimensions exceeds pgvector limit (2000). "
                "Vector search will use sequential scan. Consider reducing dimensions.",
                dimensions,
            )

        # Round-3 P2 R20-P2-a: pin the semantic_cache query_embedding
        # column to the same dimensions. Previously declared as plain
        # `vector` (any-dim) and never aligned; a dim change between
        # deploys left stale rows whose pgvector `<=>` operator threw
        # "different vector dimensions" on every subsequent lookup,
        # silently swallowed by the SELECT's generic exception handler.
        # TRUNCATE on mismatch because `<=>` can't be coerced across
        # dims — we'd otherwise still error on existing rows.
        try:
            cache_col_type = await conn.fetchval(
                """
                SELECT format_type(atttypid, atttypmod)
                FROM pg_attribute
                WHERE attrelid = $1::regclass AND attname = 'query_embedding'
                """,
                f"{SCHEMA}.semantic_cache",
            )
        except asyncpg.exceptions.UndefinedTableError:
            # semantic_cache is created lazily on first use; nothing to pin yet.
            cache_col_type = None
        if cache_col_type is not None and cache_col_type != expected_type:
            logger.info(
                "Pinning {}.semantic_cache.query_embedding to vector({}); truncating stale rows",
                SCHEMA,
                dimensions,
            )
            await conn.execute(f"TRUNCATE TABLE {SCHEMA}.semantic_cache")
            await conn.execute(
                f"ALTER TABLE {SCHEMA}.semantic_cache ALTER COLUMN query_embedding TYPE vector({dimensions})",
            )

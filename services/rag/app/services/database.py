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
            server_settings={"search_path": f"{SCHEMA},public"},
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


async def ensure_embedding_dimensions(pool: asyncpg.Pool, dimensions: int) -> None:
    """Pin the embedding column to explicit dimensions and create HNSW index."""
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

"""PostgreSQL connection pool for the RAG service.

Connects to the tale_knowledge database with search_path set to
private_knowledge schema. Handles embedding dimension validation
and HNSW index creation at startup.
"""

import asyncpg
from loguru import logger

from tale_shared.db import acquire_with_retry

from ..config import settings

_pool: asyncpg.Pool | None = None

SCHEMA = "private_knowledge"


async def init_pool() -> asyncpg.Pool:
    """Initialize the asyncpg connection pool.

    Returns the pool for use by other services.
    """
    global _pool
    if _pool is not None:
        return _pool

    db_url = settings.get_database_url()
    _pool = await asyncpg.create_pool(
        db_url,
        min_size=2,
        max_size=10,
        command_timeout=30,
        server_settings={"search_path": f"{SCHEMA},public"},
    )
    logger.info(f"Created connection pool for {SCHEMA} schema")
    return _pool


async def get_pool() -> asyncpg.Pool:
    if _pool is None:
        return await init_pool()
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
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
            logger.warning(f"{SCHEMA}.chunks table does not exist yet, skipping dimension check")
            return

        expected_type = f"vector({dimensions})"

        if col_type == "vector":
            logger.info(f"Pinning {SCHEMA}.chunks.embedding to vector({dimensions})")
            await conn.execute(f"ALTER TABLE {SCHEMA}.chunks ALTER COLUMN embedding TYPE vector({dimensions})")
        elif col_type != expected_type:
            logger.warning(
                f"Embedding column is {col_type}, expected {expected_type}. "
                "Dimension mismatch — existing embeddings may need re-generation."
            )
            await conn.execute(f"ALTER TABLE {SCHEMA}.chunks ALTER COLUMN embedding TYPE vector({dimensions})")
        else:
            logger.info(f"Embedding column already pinned to {expected_type}")

        try:
            await conn.execute(f"SELECT {SCHEMA}.create_chunks_hnsw_index()")
            logger.info("HNSW index ensured")
        except asyncpg.exceptions.ProgramLimitExceededError:
            logger.warning(
                f"Cannot create HNSW index: {dimensions} dimensions exceeds pgvector limit (2000). "
                "Vector search will use sequential scan. Consider reducing dimensions."
            )

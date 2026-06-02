"""Construct the process-singleton VectorStore from the deployment config."""

from __future__ import annotations

import asyncpg
from loguru import logger

from .base import VectorStore
from .config_reader import VectorDbConfig, load_vectordb_config
from .postgres_store import PostgresVectorStore


def get_vector_store(pool: asyncpg.Pool, config: VectorDbConfig | None = None) -> VectorStore:
    """Build the active vector-store driver.

    Reads the deployment config (or takes an explicit one for tests) and
    returns the matching driver. The Qdrant client is imported lazily so
    deployments on the built-in pgvector backend don't require the
    optional `qdrant-client` dependency to be installed.
    """
    cfg = config or load_vectordb_config()

    if cfg.backend == "qdrant":
        from .qdrant_store import QdrantVectorStore

        logger.info("Vector store backend: qdrant ({})", cfg.qdrant_url)
        return QdrantVectorStore(pool=pool, config=cfg)

    logger.info("Vector store backend: pgvector (built-in)")
    return PostgresVectorStore(pool)

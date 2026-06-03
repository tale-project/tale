"""Construct a per-org VectorStore from that org's config."""

from __future__ import annotations

import asyncpg
from loguru import logger

from .base import VectorStore
from .config_reader import VectorDbConfig, load_vectordb_config
from .postgres_store import PostgresVectorStore


def get_vector_store(
    pool: asyncpg.Pool,
    config: VectorDbConfig | None = None,
    org_slug: str | None = None,
) -> VectorStore:
    """Build an org's vector-store driver.

    Reads the org's config via ``org_slug`` (or takes an explicit ``config``
    for tests) and returns the matching driver. The Qdrant client is imported
    lazily so orgs on the built-in pgvector backend don't require the optional
    ``qdrant-client`` dependency to be installed.

    Exactly one of ``config`` / ``org_slug`` must be provided — there is no
    deployment-wide default config to fall back on.
    """
    if config is None:
        if org_slug is None:
            raise ValueError("get_vector_store requires either config or org_slug")
        config = load_vectordb_config(org_slug)
    cfg = config

    if cfg.backend == "qdrant":
        from .qdrant_store import QdrantVectorStore

        logger.info("Vector store backend: qdrant ({})", cfg.qdrant_url)
        return QdrantVectorStore(pool=pool, config=cfg)

    if cfg.backend == "pgvector_external":
        from .external_pgvector_store import ExternalPgvectorStore

        logger.info(
            "Vector store backend: pgvector_external ({}:{}/{})",
            cfg.pg_host,
            cfg.pg_port,
            cfg.pg_database,
        )
        return ExternalPgvectorStore(pool=pool, config=cfg)

    logger.info("Vector store backend: pgvector (built-in)")
    return PostgresVectorStore(pool)

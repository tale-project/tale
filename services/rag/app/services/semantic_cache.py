"""Semantic cache for RAG search results.

Two-tier approach: exact-match on query text, then cosine similarity
on query embeddings. Stores results with TTL and supports invalidation
by file IDs.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

import asyncpg
from loguru import logger
from tale_shared.db import acquire_with_retry

SCHEMA = "private_knowledge"


class CacheEntry:
    def __init__(
        self,
        *,
        query_text: str,
        response_text: str,
        metadata: dict[str, Any] | None = None,
        hit_count: int = 0,
        created_at: datetime | None = None,
    ):
        self.query_text = query_text
        self.response_text = response_text
        self.metadata = metadata or {}
        self.hit_count = hit_count
        self.created_at = created_at


class SemanticCache:
    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool

    async def ensure_table(self) -> None:
        """Create the semantic_cache table if it does not exist."""
        async with acquire_with_retry(self._pool) as conn:
            await conn.execute(f"""
                CREATE TABLE IF NOT EXISTS {SCHEMA}.semantic_cache (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    query_text TEXT NOT NULL,
                    query_embedding vector NOT NULL,
                    response_text TEXT NOT NULL,
                    metadata JSONB DEFAULT '{{}}'::jsonb,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    expires_at TIMESTAMPTZ NOT NULL,
                    hit_count INTEGER NOT NULL DEFAULT 0,
                    file_ids TEXT[] DEFAULT '{{}}'
                )
            """)
            # Create HNSW index for cosine similarity lookups
            await conn.execute(f"""
                CREATE INDEX IF NOT EXISTS idx_semantic_cache_embedding
                ON {SCHEMA}.semantic_cache
                USING hnsw (query_embedding vector_cosine_ops)
            """)
            # Index for expiration cleanup
            await conn.execute(f"""
                CREATE INDEX IF NOT EXISTS idx_semantic_cache_expires_at
                ON {SCHEMA}.semantic_cache (expires_at)
            """)
            # Index for file-based invalidation
            await conn.execute(f"""
                CREATE INDEX IF NOT EXISTS idx_semantic_cache_file_ids
                ON {SCHEMA}.semantic_cache USING gin (file_ids)
            """)

    async def lookup(
        self,
        query_embedding: list[float],
        *,
        threshold: float = 0.95,
    ) -> CacheEntry | None:
        """Find a cached result by cosine similarity.

        Args:
            query_embedding: Embedding vector for the query.
            threshold: Minimum cosine similarity (0.0 to 1.0).

        Returns:
            CacheEntry if a sufficiently similar cached query exists, else None.
        """
        vec_str = json.dumps(query_embedding)
        now = datetime.now(UTC)

        try:
            async with acquire_with_retry(self._pool) as conn:
                row = await conn.fetchrow(
                    f"""
                    SELECT query_text, response_text, metadata, hit_count, created_at,
                           1 - (query_embedding <=> $1::vector) AS similarity
                    FROM {SCHEMA}.semantic_cache
                    WHERE expires_at > $2
                      AND 1 - (query_embedding <=> $1::vector) >= $3
                    ORDER BY query_embedding <=> $1::vector
                    LIMIT 1
                    """,
                    vec_str,
                    now,
                    threshold,
                )

                if row is None:
                    return None

                # Increment hit count (fire-and-forget)
                await conn.execute(
                    f"""
                    UPDATE {SCHEMA}.semantic_cache
                    SET hit_count = hit_count + 1
                    WHERE query_text = $1 AND expires_at > $2
                    """,
                    row["query_text"],
                    now,
                )

                metadata = row["metadata"] if row["metadata"] else {}
                if isinstance(metadata, str):
                    metadata = json.loads(metadata)

                return CacheEntry(
                    query_text=row["query_text"],
                    response_text=row["response_text"],
                    metadata=metadata,
                    hit_count=row["hit_count"] + 1,
                    created_at=row["created_at"],
                )
        except (asyncpg.UndefinedTableError, asyncpg.UndefinedColumnError):
            logger.debug("Semantic cache table not ready, skipping lookup")
            return None
        except Exception:
            logger.warning("Semantic cache lookup failed", exc_info=True)
            return None

    async def store(
        self,
        query: str,
        embedding: list[float],
        response: str,
        *,
        metadata: dict[str, Any] | None = None,
        ttl_hours: int = 24,
        file_ids: list[str] | None = None,
    ) -> None:
        """Store a query-response pair in the cache.

        Args:
            query: Original query text.
            embedding: Query embedding vector.
            response: Response text to cache.
            metadata: Optional metadata dict.
            ttl_hours: Time-to-live in hours.
            file_ids: File IDs referenced by the response (for invalidation).
        """
        vec_str = json.dumps(embedding)
        now = datetime.now(UTC)
        expires_at = now + timedelta(hours=ttl_hours)
        meta_json = json.dumps(metadata) if metadata else "{}"

        try:
            async with acquire_with_retry(self._pool) as conn:
                await conn.execute(
                    f"""
                    INSERT INTO {SCHEMA}.semantic_cache
                        (query_text, query_embedding, response_text, metadata, expires_at, file_ids)
                    VALUES ($1, $2::vector, $3, $4::jsonb, $5, $6)
                    """,
                    query,
                    vec_str,
                    response,
                    meta_json,
                    expires_at,
                    file_ids or [],
                )
        except (asyncpg.UndefinedTableError, asyncpg.UndefinedColumnError):
            logger.debug("Semantic cache table not ready, skipping store")
        except Exception:
            logger.warning("Semantic cache store failed", exc_info=True)

    async def invalidate(self, file_ids: list[str]) -> int:
        """Remove cache entries referencing any of the given file IDs.

        Args:
            file_ids: File IDs whose cached entries should be purged.

        Returns:
            Number of entries deleted.
        """
        if not file_ids:
            return 0

        try:
            async with acquire_with_retry(self._pool) as conn:
                result = await conn.execute(
                    f"""
                    DELETE FROM {SCHEMA}.semantic_cache
                    WHERE file_ids && $1
                    """,
                    file_ids,
                )
                count = int(result.split()[-1]) if result else 0
                if count > 0:
                    logger.info("Invalidated {} semantic cache entries for file_ids={}", count, file_ids)
                return count
        except (asyncpg.UndefinedTableError, asyncpg.UndefinedColumnError):
            return 0
        except Exception:
            logger.warning("Semantic cache invalidation failed", exc_info=True)
            return 0

    async def cleanup(self) -> int:
        """Remove expired cache entries.

        Returns:
            Number of entries deleted.
        """
        now = datetime.now(UTC)
        try:
            async with acquire_with_retry(self._pool) as conn:
                result = await conn.execute(
                    f"""
                    DELETE FROM {SCHEMA}.semantic_cache
                    WHERE expires_at <= $1
                    """,
                    now,
                )
                count = int(result.split()[-1]) if result else 0
                if count > 0:
                    logger.info("Cleaned up {} expired semantic cache entries", count)
                return count
        except (asyncpg.UndefinedTableError, asyncpg.UndefinedColumnError):
            return 0
        except Exception:
            logger.warning("Semantic cache cleanup failed", exc_info=True)
            return 0

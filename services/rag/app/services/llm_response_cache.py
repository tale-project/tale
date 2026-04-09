"""Semantic cache for LLM response results.

Stores LLM responses with their user message embeddings for semantic
similarity lookup. Allows cache hits when users ask semantically similar
questions to the same agent/model combination.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

import asyncpg
from loguru import logger
from tale_shared.db import acquire_with_retry

SCHEMA = "private_knowledge"
TABLE = f"{SCHEMA}.llm_response_cache"


class LlmCacheEntry:
    def __init__(
        self,
        *,
        response_text: str,
        provider: str | None = None,
        usage: dict[str, Any] | None = None,
        similarity: float = 0.0,
        hit_count: int = 0,
    ):
        self.response_text = response_text
        self.provider = provider
        self.usage = usage or {}
        self.similarity = similarity
        self.hit_count = hit_count


class LlmResponseCache:
    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool

    async def ensure_table(self) -> None:
        """Create the llm_response_cache table if it does not exist."""
        async with acquire_with_retry(self._pool) as conn:
            await conn.execute(f"""
                CREATE TABLE IF NOT EXISTS {TABLE} (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    agent_name TEXT NOT NULL,
                    model TEXT NOT NULL,
                    user_id TEXT,
                    organization_id TEXT,
                    user_message TEXT NOT NULL,
                    user_message_embedding vector NOT NULL,
                    response_text TEXT NOT NULL,
                    provider TEXT,
                    usage JSONB DEFAULT '{{}}'::jsonb,
                    metadata JSONB DEFAULT '{{}}'::jsonb,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    expires_at TIMESTAMPTZ NOT NULL,
                    hit_count INTEGER NOT NULL DEFAULT 0
                )
            """)
            await conn.execute(f"""
                CREATE INDEX IF NOT EXISTS idx_llm_cache_embedding
                ON {TABLE}
                USING hnsw (user_message_embedding vector_cosine_ops)
            """)
            await conn.execute(f"""
                CREATE INDEX IF NOT EXISTS idx_llm_cache_agent_model
                ON {TABLE} (agent_name, model)
            """)
            await conn.execute(f"""
                CREATE INDEX IF NOT EXISTS idx_llm_cache_expires_at
                ON {TABLE} (expires_at)
            """)
            await conn.execute(f"""
                CREATE INDEX IF NOT EXISTS idx_llm_cache_user_id
                ON {TABLE} (user_id)
            """)
            await conn.execute(f"""
                CREATE INDEX IF NOT EXISTS idx_llm_cache_organization_id
                ON {TABLE} (organization_id)
            """)

    async def lookup(
        self,
        agent_name: str,
        model: str,
        user_message_embedding: list[float],
        *,
        threshold: float = 0.95,
    ) -> LlmCacheEntry | None:
        """Find a cached LLM response by cosine similarity.

        Args:
            agent_name: Agent identifier (exact match filter).
            model: Model identifier (exact match filter).
            user_message_embedding: Embedding vector for the user message.
            threshold: Minimum cosine similarity (0.0 to 1.0).

        Returns:
            LlmCacheEntry if a sufficiently similar cached query exists, else None.
        """
        vec_str = json.dumps(user_message_embedding)
        now = datetime.now(UTC)

        try:
            async with acquire_with_retry(self._pool) as conn:
                row = await conn.fetchrow(
                    f"""
                    SELECT response_text, provider, usage, hit_count,
                           1 - (user_message_embedding <=> $1::vector) AS similarity
                    FROM {TABLE}
                    WHERE agent_name = $2
                      AND model = $3
                      AND expires_at > $4
                      AND 1 - (user_message_embedding <=> $1::vector) >= $5
                    ORDER BY user_message_embedding <=> $1::vector
                    LIMIT 1
                    """,
                    vec_str,
                    agent_name,
                    model,
                    now,
                    threshold,
                )

                if row is None:
                    return None

                # Increment hit count
                await conn.execute(
                    f"""
                    UPDATE {TABLE}
                    SET hit_count = hit_count + 1
                    WHERE agent_name = $1 AND model = $2
                      AND response_text = $3 AND expires_at > $4
                    """,
                    agent_name,
                    model,
                    row["response_text"],
                    now,
                )

                usage = row["usage"] if row["usage"] else {}
                if isinstance(usage, str):
                    usage = json.loads(usage)

                return LlmCacheEntry(
                    response_text=row["response_text"],
                    provider=row["provider"],
                    usage=usage,
                    similarity=float(row["similarity"]),
                    hit_count=row["hit_count"] + 1,
                )
        except (asyncpg.UndefinedTableError, asyncpg.UndefinedColumnError):
            logger.debug("LLM response cache table not ready, skipping lookup")
            return None
        except Exception:
            logger.warning("LLM response cache lookup failed", exc_info=True)
            return None

    async def store(
        self,
        agent_name: str,
        model: str,
        user_message: str,
        embedding: list[float],
        response_text: str,
        *,
        provider: str | None = None,
        usage: dict[str, Any] | None = None,
        ttl_hours: int = 24,
        user_id: str | None = None,
        organization_id: str | None = None,
    ) -> None:
        """Store an LLM response in the cache.

        Args:
            agent_name: Agent identifier.
            model: Model identifier.
            user_message: Original user message text.
            embedding: User message embedding vector.
            response_text: LLM response text to cache.
            provider: LLM provider name.
            usage: Token usage stats.
            ttl_hours: Time-to-live in hours.
            user_id: User ID for future cross-conversation memory.
            organization_id: Organization ID for scoping.
        """
        vec_str = json.dumps(embedding)
        now = datetime.now(UTC)
        expires_at = now + timedelta(hours=ttl_hours)
        usage_json = json.dumps(usage) if usage else "{}"

        try:
            async with acquire_with_retry(self._pool) as conn:
                await conn.execute(
                    f"""
                    INSERT INTO {TABLE}
                        (agent_name, model, user_id, organization_id,
                         user_message, user_message_embedding, response_text,
                         provider, usage, expires_at)
                    VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8, $9::jsonb, $10)
                    """,
                    agent_name,
                    model,
                    user_id,
                    organization_id,
                    user_message,
                    vec_str,
                    response_text,
                    provider,
                    usage_json,
                    expires_at,
                )
        except (asyncpg.UndefinedTableError, asyncpg.UndefinedColumnError):
            logger.debug("LLM response cache table not ready, skipping store")
        except Exception:
            logger.warning("LLM response cache store failed", exc_info=True)

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
                    DELETE FROM {TABLE}
                    WHERE expires_at <= $1
                    """,
                    now,
                )
                count = int(result.split()[-1]) if result else 0
                if count > 0:
                    logger.info("Cleaned up {} expired LLM response cache entries", count)
                return count
        except (asyncpg.UndefinedTableError, asyncpg.UndefinedColumnError):
            return 0
        except Exception:
            logger.warning("LLM response cache cleanup failed", exc_info=True)
            return 0

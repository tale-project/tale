"""Hybrid search service for the RAG pipeline.

BM25 full-text (pg_search) + pgvector similarity with RRF fusion.
Multi-tenant filtering via WHERE team_id/user_id.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import asyncpg
from loguru import logger

from tale_knowledge.embedding import EmbeddingService
from tale_knowledge.retrieval import merge_rrf
from tale_shared.db import acquire_with_retry

SCHEMA = "private_knowledge"


class RagSearchService:
    def __init__(self, pool: asyncpg.Pool, embedding_service: EmbeddingService):
        self._pool = pool
        self._embedding = embedding_service

    async def search(
        self,
        query: str,
        *,
        team_ids: list[str] | None = None,
        user_id: str | None = None,
        top_k: int = 10,
    ) -> list[dict[str, Any]]:
        """Hybrid BM25 + vector search with tenant filtering.

        Args:
            query: Search query text.
            team_ids: Optional team IDs to filter by.
            user_id: Optional user ID to filter by.
            top_k: Maximum number of results to return.

        Returns:
            List of result dicts with content, score, document_id.
        """
        query_embedding: list[float] | None = None
        try:
            embedding_task = asyncio.create_task(self._embedding.embed_query(query))
            fts_task = asyncio.create_task(self._fts_search(query, team_ids, user_id, top_k * 3))

            query_embedding, fts_results = await asyncio.gather(embedding_task, fts_task)
            vector_results = await self._vector_search(query_embedding, team_ids, user_id, top_k * 3)

            if not fts_results and not vector_results:
                return []

            merged = merge_rrf([fts_results, vector_results], top_k)

            return [
                {
                    "content": item["chunk_content"],
                    "score": item["rrf_score"],
                    "document_id": str(item["document_id"]) if item.get("document_id") else None,
                }
                for item in merged
            ]

        except asyncpg.UndefinedTableError:
            logger.info("Tables not yet created, returning empty results")
            return []
        except asyncpg.UndefinedColumnError:
            logger.info("Schema not ready, returning empty results")
            return []
        except Exception as e:
            if "bm25" in str(e).lower() and "index" in str(e).lower():
                logger.warning("BM25 index not ready: {}, falling back to vector-only", e)
                if query_embedding is None:
                    query_embedding = await self._embedding.embed_query(query)
                vector_results = await self._vector_search(query_embedding, team_ids, user_id, top_k)
                return [
                    {
                        "content": item["chunk_content"],
                        "score": 1.0 / (i + 1),
                        "document_id": str(item["document_id"]) if item.get("document_id") else None,
                    }
                    for i, item in enumerate(vector_results)
                ]
            raise

    def _build_tenant_clause(
        self, team_ids: list[str] | None, user_id: str | None, param_offset: int
    ) -> tuple[str, list[Any]]:
        """Build WHERE clause for tenant filtering."""
        conditions: list[str] = []
        params: list[Any] = []
        idx = param_offset

        if team_ids:
            idx += 1
            conditions.append(f"team_id = ANY(${idx})")
            params.append(team_ids)
        if user_id:
            idx += 1
            conditions.append(f"user_id = ${idx}")
            params.append(user_id)

        if not conditions:
            return "", params

        return " AND (" + " OR ".join(conditions) + ")", params

    async def _fts_search(
        self,
        query: str,
        team_ids: list[str] | None,
        user_id: str | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        tenant_clause, tenant_params = self._build_tenant_clause(team_ids, user_id, 1)

        sql = f"""
            SELECT id, chunk_content, chunk_index, document_id,
                   paradedb.score(id) AS score
            FROM {SCHEMA}.chunks
            WHERE id @@@ paradedb.match('chunk_content', $1)
            {tenant_clause}
            ORDER BY score DESC
            LIMIT ${2 + len(tenant_params)}
        """
        params = [query, *tenant_params, limit]

        try:
            async with acquire_with_retry(self._pool) as conn:
                rows = await conn.fetch(sql, *params)
                return [dict(r) for r in rows]
        except Exception as e:
            if "bm25" in str(e).lower():
                logger.warning("BM25 search failed: {}", e)
                return []
            raise

    async def _vector_search(
        self,
        embedding: list[float],
        team_ids: list[str] | None,
        user_id: str | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        vec_str = json.dumps(embedding)
        tenant_clause, tenant_params = self._build_tenant_clause(team_ids, user_id, 1)

        sql = f"""
            SELECT id, chunk_content, chunk_index, document_id,
                   1 - (embedding <=> $1::vector) AS score
            FROM {SCHEMA}.chunks
            WHERE embedding IS NOT NULL
            {tenant_clause}
            ORDER BY embedding <=> $1::vector
            LIMIT ${2 + len(tenant_params)}
        """
        params = [vec_str, *tenant_params, limit]

        async with acquire_with_retry(self._pool) as conn:
            rows = await conn.fetch(sql, *params)
            return [dict(r) for r in rows]

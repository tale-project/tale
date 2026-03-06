"""Hybrid search service for the RAG pipeline.

BM25 full-text (pg_search) + pgvector similarity with RRF fusion.
Scoping via document_ids and/or user_id.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, ClassVar

import asyncpg
from loguru import logger
from tale_knowledge.embedding import EmbeddingService
from tale_knowledge.retrieval import merge_rrf
from tale_shared.db import acquire_with_retry

SCHEMA = "private_knowledge"


class RagSearchService:
    _background_tasks: ClassVar[set[asyncio.Task[None]]] = set()

    def __init__(self, pool: asyncpg.Pool, embedding_service: EmbeddingService):
        self._pool = pool
        self._embedding = embedding_service

    async def search(
        self,
        query: str,
        *,
        document_ids: list[str] | None = None,
        user_id: str | None = None,
        top_k: int = 10,
    ) -> list[dict[str, Any]]:
        """Hybrid BM25 + vector search with document/user scoping.

        Args:
            query: Search query text.
            document_ids: Optional document IDs to restrict search to.
            user_id: Optional user ID to filter by.
            top_k: Maximum number of results to return.

        Returns:
            List of result dicts with content, score, document_id.
        """
        query_embedding: list[float] | None = None
        try:
            embedding_task = asyncio.create_task(self._embedding.embed_query(query))
            fts_task = asyncio.create_task(self._fts_search(query, document_ids, user_id, top_k * 3))

            query_embedding, fts_results = await asyncio.gather(embedding_task, fts_task)
            vector_results = await self._vector_search(query_embedding, document_ids, user_id, top_k * 3)

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
        except (asyncpg.InternalServerError, asyncpg.DataCorruptedError) as e:
            is_bm25 = "bm25" in str(e).lower()
            is_corruption = isinstance(e, asyncpg.DataCorruptedError)

            if is_bm25 or is_corruption:
                logger.warning("BM25 index issue (corruption={}): {}, falling back to vector-only", is_corruption, e)

                if is_corruption:
                    task = asyncio.create_task(self._rebuild_bm25_index())
                    self._background_tasks.add(task)
                    task.add_done_callback(self._background_tasks.discard)

                if query_embedding is None:
                    query_embedding = await self._embedding.embed_query(query)
                vector_results = await self._vector_search(query_embedding, document_ids, user_id, top_k)
                return [
                    {
                        "content": item["chunk_content"],
                        "score": 1.0 / (i + 1),
                        "document_id": str(item["document_id"]) if item.get("document_id") else None,
                    }
                    for i, item in enumerate(vector_results)
                ]
            raise

    def _build_scope_clause(
        self, document_ids: list[str] | None, user_id: str | None, param_offset: int
    ) -> tuple[str, list[Any]]:
        """Build WHERE clause for document/user scoping."""
        conditions: list[str] = []
        params: list[Any] = []
        idx = param_offset

        if document_ids:
            idx += 1
            conditions.append(f"document_id IN (SELECT id FROM {SCHEMA}.documents WHERE document_id = ANY(${idx}))")
            params.append(document_ids)
        if user_id:
            idx += 1
            conditions.append(f"user_id = ${idx}")
            params.append(user_id)

        if not conditions:
            return "", params

        return " AND (" + " OR ".join(conditions) + ")", params

    async def _rebuild_bm25_index(self) -> None:
        """Rebuild the BM25 index after corruption. Runs as a background task."""
        try:
            logger.warning("Rebuilding BM25 index due to corruption")
            async with acquire_with_retry(self._pool) as conn:
                await conn.execute(f"REINDEX INDEX {SCHEMA}.idx_pk_chunks_bm25")
            logger.info("BM25 index rebuilt successfully")
        except Exception as e:
            logger.error("BM25 index rebuild failed: {}", e)

    async def _fts_search(
        self,
        query: str,
        document_ids: list[str] | None,
        user_id: str | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        tenant_clause, tenant_params = self._build_scope_clause(document_ids, user_id, 1)

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
        except asyncpg.DataCorruptedError as e:
            logger.warning("BM25 index corrupted: {}", e)
            return []
        except asyncpg.InternalServerError as e:
            if "bm25" in str(e).lower():
                logger.warning("BM25 search failed: {}", e)
                return []
            raise

    async def _vector_search(
        self,
        embedding: list[float],
        document_ids: list[str] | None,
        user_id: str | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        vec_str = json.dumps(embedding)
        tenant_clause, tenant_params = self._build_scope_clause(document_ids, user_id, 1)

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

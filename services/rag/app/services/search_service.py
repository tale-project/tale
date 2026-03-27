"""Hybrid search service for the RAG pipeline.

BM25 full-text (pg_search) + pgvector similarity with RRF fusion.
Scoping via file_ids.
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

from ..config import settings

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
        file_ids: list[str] | None = None,
        top_k: int = 10,
    ) -> list[dict[str, Any]]:
        """Hybrid BM25 + vector search with document scoping.

        Args:
            query: Search query text.
            file_ids: Optional file IDs to restrict search to.
            top_k: Maximum number of results to return.

        Returns:
            List of result dicts with content, score, file_id.
        """
        query_embedding: list[float] | None = None
        try:
            embedding_task = asyncio.create_task(self._embedding.embed_query(query))
            fts_task = asyncio.create_task(self._fts_search(query, file_ids, top_k * 3))

            query_embedding, fts_results = await asyncio.gather(embedding_task, fts_task)
            vector_results = await self._vector_search(query_embedding, file_ids, top_k * 3)

            if not fts_results and not vector_results:
                return []

            merged = merge_rrf([fts_results, vector_results], top_k)

            if settings.recency_boost_enabled:
                _apply_recency_boost(
                    merged,
                    decay_base=settings.recency_decay_base,
                    max_age_days=settings.recency_max_age_days,
                )

            return [
                {
                    "content": item["chunk_content"],
                    "score": item["rrf_score"],
                    "file_id": str(item["file_id"]) if item.get("file_id") else None,
                    "filename": item.get("filename"),
                    "source_created_at": item.get("source_created_at"),
                    "source_modified_at": item.get("source_modified_at"),
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
                vector_results = await self._vector_search(query_embedding, file_ids, top_k)
                return [
                    {
                        "content": item["chunk_content"],
                        "score": 1.0 / (i + 1),
                        "file_id": str(item["file_id"]) if item.get("file_id") else None,
                        "filename": item.get("filename"),
                        "source_created_at": item.get("source_created_at"),
                        "source_modified_at": item.get("source_modified_at"),
                    }
                    for i, item in enumerate(vector_results)
                ]
            raise

    def _build_scope_clause(self, file_ids: list[str] | None, param_offset: int) -> tuple[str, list[Any]]:
        """Build WHERE clause for document scoping."""
        if not file_ids:
            return "", []

        idx = param_offset + 1
        clause = f" AND c.document_id IN (SELECT id FROM {SCHEMA}.documents WHERE file_id = ANY(${idx}))"
        return clause, [file_ids]

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
        file_ids: list[str] | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        tenant_clause, tenant_params = self._build_scope_clause(file_ids, 1)

        sql = f"""
            SELECT c.id, c.chunk_content, c.chunk_index, c.document_id,
                   d.file_id, d.filename,
                   d.source_created_at, d.source_modified_at, d.created_at,
                   paradedb.score(c.id) AS score
            FROM {SCHEMA}.chunks c
            LEFT JOIN {SCHEMA}.documents d ON c.document_id = d.id
            WHERE c.id @@@ paradedb.match('chunk_content', $1)
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
            logger.warning("FTS search failed: {}", e)
            return []

    async def _vector_search(
        self,
        embedding: list[float],
        file_ids: list[str] | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        vec_str = json.dumps(embedding)
        tenant_clause, tenant_params = self._build_scope_clause(file_ids, 1)

        sql = f"""
            SELECT c.id, c.chunk_content, c.chunk_index, c.document_id,
                   d.file_id, d.filename,
                   d.source_created_at, d.source_modified_at, d.created_at,
                   1 - (c.embedding <=> $1::vector) AS score
            FROM {SCHEMA}.chunks c
            LEFT JOIN {SCHEMA}.documents d ON c.document_id = d.id
            WHERE c.embedding IS NOT NULL
            {tenant_clause}
            ORDER BY c.embedding <=> $1::vector
            LIMIT ${2 + len(tenant_params)}
        """
        params = [vec_str, *tenant_params, limit]

        async with acquire_with_retry(self._pool) as conn:
            rows = await conn.fetch(sql, *params)
            return [dict(r) for r in rows]


def _apply_recency_boost(
    results: list[dict[str, Any]],
    decay_base: float,
    max_age_days: int,
) -> None:
    """Scale RRF scores by document age so newer documents rank higher.

    Modifies *results* in place: adjusts ``rrf_score``, re-normalises so the
    top result equals 1.0, and re-sorts descending.
    """
    from datetime import UTC, datetime

    now = datetime.now(UTC)
    for item in results:
        doc_ts = item.get("source_modified_at") or item.get("created_at")
        if doc_ts is None:
            item["rrf_score"] *= decay_base
            continue
        age_days = (now - doc_ts).total_seconds() / 86400
        recency_factor = max(0.0, 1.0 - age_days / max_age_days)
        boost = decay_base + (1.0 - decay_base) * recency_factor
        item["rrf_score"] *= boost

    max_score = max((r["rrf_score"] for r in results), default=1.0)
    if max_score > 0:
        for r in results:
            r["rrf_score"] /= max_score

    results.sort(key=lambda x: x.get("rrf_score", 0), reverse=True)

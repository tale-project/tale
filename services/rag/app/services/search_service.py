"""Hybrid search service for the RAG pipeline.

BM25 full-text (pg_search) + pgvector similarity with RRF fusion.
Scoping via file_ids. Optional semantic caching and cross-encoder re-ranking.
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any, ClassVar

import asyncpg
from loguru import logger
from tale_knowledge.embedding import EmbeddingService, EmbeddingUsage
from tale_knowledge.retrieval import merge_rrf
from tale_knowledge.retrieval.reranker import Reranker
from tale_shared.db import acquire_with_retry

from ..config import settings
from .semantic_cache import SemanticCache

SCHEMA = "private_knowledge"


class RagSearchService:
    _background_tasks: ClassVar[set[asyncio.Task[None]]] = set()

    def __init__(self, pool: asyncpg.Pool, embedding_service: EmbeddingService):
        self._pool = pool
        self._embedding = embedding_service
        self._semantic_cache: SemanticCache | None = SemanticCache(pool) if settings.semantic_cache_enabled else None
        self._reranker: Reranker | None = (
            Reranker(
                model_name=settings.reranking_model,
                provider=settings.reranking_provider,
            )
            if settings.reranking_enabled
            else None
        )

    async def search(
        self,
        query: str,
        *,
        file_ids: list[str] | None = None,
        top_k: int = 10,
        similarity_threshold: float = 0.0,
    ) -> list[dict[str, Any]]:
        """Hybrid BM25 + vector search with document scoping.

        Args:
            query: Search query text.
            file_ids: Optional file IDs to restrict search to.
            top_k: Maximum number of results to return.
            similarity_threshold: Minimum cosine similarity for vector results.
                Results below this threshold are discarded before RRF merge.

        Returns:
            List of result dicts with content, score, file_id.
            Embedding token usage available via `self.last_search_usage` after call.
        """
        query_embedding: list[float] | None = None
        self.last_search_usage = EmbeddingUsage(model=self._embedding._model)
        try:
            t0 = time.time()
            embedding_task = asyncio.create_task(self._embedding.embed_query_with_usage(query))
            fts_task = asyncio.create_task(self._fts_search(query, file_ids, top_k * 3))

            query_result, fts_results = await asyncio.gather(embedding_task, fts_task)
            query_embedding = query_result.embedding
            self.last_search_usage = query_result.usage
            embed_fts_ms = (time.time() - t0) * 1000
            logger.debug("PERF embed+FTS parallel: {:.1f}ms", embed_fts_ms)

            # Semantic cache: check for a cached result before vector search
            if self._semantic_cache and query_embedding:
                cache_t0 = time.time()
                cached = await self._semantic_cache.lookup(
                    query_embedding,
                    threshold=settings.semantic_cache_similarity_threshold,
                )
                cache_ms = (time.time() - cache_t0) * 1000
                if cached:
                    logger.debug("Semantic cache hit for query (lookup {:.1f}ms): {}", cache_ms, query[:80])
                    try:
                        cached_results = json.loads(cached.response_text)
                        for r in cached_results:
                            r["cached"] = True
                        return cached_results
                    except (json.JSONDecodeError, TypeError):
                        logger.warning("Invalid cached response format, performing fresh search")

            vec_t0 = time.time()
            vector_results = await self._vector_search(query_embedding, file_ids, top_k * 3)
            vec_ms = (time.time() - vec_t0) * 1000
            logger.debug("PERF vector search: {:.1f}ms", vec_ms)

            # Pre-filter vector results by cosine similarity to reject clearly irrelevant content.
            # If ALL vector results are below threshold, the query is semantically irrelevant
            # to the indexed documents — discard FTS results too (they are keyword noise).
            if similarity_threshold > 0:
                pre_count = len(vector_results)
                top_score = max((r["score"] for r in vector_results), default=0.0)
                vector_results = [r for r in vector_results if r["score"] >= similarity_threshold]
                if pre_count != len(vector_results):
                    logger.debug(
                        "Vector pre-filter: {}/{} results passed threshold {} (top score {:.3f})",
                        len(vector_results),
                        pre_count,
                        similarity_threshold,
                        top_score,
                    )
                if pre_count > 0 and not vector_results:
                    return []

            if not fts_results and not vector_results:
                return []

            merged = merge_rrf([fts_results, vector_results], top_k)

            if settings.recency_boost_enabled:
                _apply_recency_boost(
                    merged,
                    decay_base=settings.recency_decay_base,
                    max_age_days=settings.recency_max_age_days,
                )

            # Re-rank merged results with cross-encoder if enabled
            if self._reranker and merged:
                rerank_t0 = time.time()
                rerank_input = [{"content": item.get("chunk_content", ""), **item} for item in merged]
                merged = await self._reranker.rerank(
                    query,
                    rerank_input,
                    top_k=settings.reranking_top_k,
                )
                rerank_ms = (time.time() - rerank_t0) * 1000
                logger.debug("PERF reranking: {:.1f}ms", rerank_ms)

            results = [
                {
                    "content": item["chunk_content"],
                    "score": item.get("reranking_score", item["rrf_score"]),
                    "file_id": str(item["file_id"]) if item.get("file_id") else None,
                    "filename": item.get("filename"),
                    "source_created_at": item.get("source_created_at"),
                    "source_modified_at": item.get("source_modified_at"),
                }
                for item in merged
            ]

            # Semantic cache: store results for future lookups
            if self._semantic_cache and query_embedding and results:
                result_file_ids = [r["file_id"] for r in results if r.get("file_id")]
                await self._semantic_cache.store(
                    query,
                    query_embedding,
                    json.dumps(results, default=str),
                    ttl_hours=settings.semantic_cache_ttl_hours,
                    file_ids=result_file_ids,
                )

            return results

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
                        "score": item["score"],
                        "file_id": str(item["file_id"]) if item.get("file_id") else None,
                        "filename": item.get("filename"),
                        "source_created_at": item.get("source_created_at"),
                        "source_modified_at": item.get("source_modified_at"),
                    }
                    for item in vector_results
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

    results.sort(key=lambda x: x.get("rrf_score", 0), reverse=True)

"""Hybrid search service for the RAG pipeline.

BM25 full-text (pg_search) + pgvector similarity with RRF fusion.
Per-tenant scoping by `org_slug` (always applied), optional further
restriction by `file_ids` and a hierarchical `folder_path` prefix.
Optional semantic caching and cross-encoder re-ranking.
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


async def _timed(name: str, coro: Any) -> Any:
    t = time.time()
    try:
        return await coro
    finally:
        logger.debug("PERF {}: {:.1f}ms", name, (time.time() - t) * 1000)


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
        org_slug: str,
        query: str,
        *,
        file_ids: list[str] | None = None,
        folder_path: str | None = None,
        top_k: int = 10,
        similarity_threshold: float = 0.0,
    ) -> tuple[list[dict[str, Any]], EmbeddingUsage]:
        """Hybrid BM25 + vector search scoped to `org_slug`.

        Args:
            org_slug: Tenant slug — ALWAYS used to filter `chunks.org_slug`
                so no cross-tenant rows can match.
            query: Search query text.
            file_ids: Optional file IDs to further restrict search to. The
                org filter is independent — file_ids only narrows within
                the org.
            folder_path: Optional hierarchical folder prefix filter
                (normalized, no surrounding slashes). Pure narrowing within
                the already-authorized file_ids scope — never an
                authorization boundary.
            top_k: Maximum number of results to return.
            similarity_threshold: Minimum cosine similarity for vector results.
                Results below this threshold are discarded before RRF merge.

        Returns:
            ``(results, embedding_usage)`` — usage returned alongside the
            results so concurrent callers can't trample each other's
            attribution via a shared singleton.
        """
        query_embedding: list[float] | None = None
        usage = EmbeddingUsage(model=self._embedding._model)
        try:
            t0 = time.time()
            query_result, fts_results = await asyncio.gather(
                _timed("embed", self._embedding.embed_query_with_usage(query)),
                _timed(
                    "fts",
                    self._fts_search(query, org_slug, file_ids, top_k * 3, folder_path=folder_path),
                ),
            )
            query_embedding = query_result.embedding
            usage = query_result.usage
            logger.debug("PERF embed+FTS total: {:.1f}ms", (time.time() - t0) * 1000)

            # Semantic cache: check for a cached result before vector search.
            # Cache is org-scoped — see SemanticCache.lookup. Bypassed (both
            # lookup and store) for folder-filtered queries: the cache key is
            # (org_slug, embedding) only, so a folder-scoped query would hit
            # unfiltered cached results and vice versa.
            if self._semantic_cache and query_embedding and not folder_path:
                cache_t0 = time.time()
                cached = await self._semantic_cache.lookup(
                    org_slug,
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
                        return cached_results, usage
                    except (json.JSONDecodeError, TypeError):
                        logger.warning("Invalid cached response format, performing fresh search")

            vec_t0 = time.time()
            vector_results = await self._vector_search(
                query_embedding, org_slug, file_ids, top_k * 3, folder_path=folder_path
            )
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
                    return [], usage

            if not fts_results and not vector_results:
                return [], usage

            merged = merge_rrf([fts_results, vector_results], top_k)

            if settings.recency_boost_enabled:
                _apply_recency_boost(
                    merged,
                    decay_base=settings.recency_decay_base,
                    max_age_days=settings.recency_max_age_days,
                )

            # Re-rank merged results with cross-encoder if enabled.
            # The reranker's input "content" and the returned payload "content"
            # both prefer `core_content` (the chunk's non-overlap forward-owning
            # span), falling back to `chunk_content` for un-reindexed rows.
            # This prevents adjacent search hits from duplicating overlap bytes
            # to the LLM once Part B Phase 3 reindex completes.
            if self._reranker and merged:
                rerank_t0 = time.time()
                rerank_input = [
                    {"content": (item.get("core_content") or item.get("chunk_content") or ""), **item}
                    for item in merged
                ]
                merged = await self._reranker.rerank(
                    query,
                    rerank_input,
                    top_k=settings.reranking_top_k,
                )
                rerank_ms = (time.time() - rerank_t0) * 1000
                logger.debug("PERF reranking: {:.1f}ms", rerank_ms)

            results = [
                {
                    "content": item.get("core_content") or item.get("chunk_content") or "",
                    "score": item.get("reranking_score", item["rrf_score"]),
                    "file_id": str(item["file_id"]) if item.get("file_id") else None,
                    "filename": item.get("filename"),
                    "source_created_at": item.get("source_created_at"),
                    "source_modified_at": item.get("source_modified_at"),
                }
                for item in merged
            ]

            # Semantic cache: store results for future lookups (org-scoped).
            # Folder-filtered results are never stored — see the lookup bypass.
            if self._semantic_cache and query_embedding and results and not folder_path:
                result_file_ids = [r["file_id"] for r in results if r.get("file_id")]
                await self._semantic_cache.store(
                    org_slug,
                    query,
                    query_embedding,
                    json.dumps(results, default=str),
                    ttl_hours=settings.semantic_cache_ttl_hours,
                    file_ids=result_file_ids,
                )

            return results, usage

        except asyncpg.UndefinedTableError:
            logger.info("Tables not yet created, returning empty results")
            return [], usage
        except asyncpg.UndefinedColumnError:
            logger.info("Schema not ready, returning empty results")
            return [], usage
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
                vector_results = await self._vector_search(
                    query_embedding, org_slug, file_ids, top_k, folder_path=folder_path
                )
                results = [
                    {
                        "content": item.get("core_content") or item.get("chunk_content") or "",
                        "score": item["score"],
                        "file_id": str(item["file_id"]) if item.get("file_id") else None,
                        "filename": item.get("filename"),
                        "source_created_at": item.get("source_created_at"),
                        "source_modified_at": item.get("source_modified_at"),
                    }
                    for item in vector_results
                ]
                return results, usage
            raise

    def _build_scope_clause(
        self,
        org_slug: str,
        file_ids: list[str] | None,
        param_offset: int,
        folder_path: str | None = None,
    ) -> tuple[str, list[Any]]:
        """Build WHERE clause for per-tenant + optional per-document scoping.

        `org_slug` is ALWAYS added as `AND c.org_slug = $N`. Document-level
        filters (`file_ids`, `folder_path`) are collected into a condition
        list applied through a single documents subquery that is itself
        org-scoped (defense in depth — even if the outer chunks filter were
        ever bypassed by a code mistake, the inner documents lookup also has
        the org filter). #1517's generic metadata filters extend the same
        condition list.

        `folder_path` is a boundary-safe hierarchical prefix: it matches the
        folder itself and any descendant ('data-room' matches
        'data-room/contracts' but NOT the sibling 'data-room-x'). The
        `left()` comparison avoids LIKE-pattern escaping for user-supplied
        paths; it is not index-sargable, which is acceptable because the
        subquery is already org- and file_ids-bounded.
        """
        org_param = param_offset + 1
        clause = f" AND c.org_slug = ${org_param}"
        params: list[Any] = [org_slug]

        doc_conditions: list[str] = []
        if file_ids:
            params.append(file_ids)
            doc_conditions.append(f"file_id = ANY(${param_offset + len(params)})")
        if folder_path:
            params.append(folder_path)
            folder_param = f"${param_offset + len(params)}"
            doc_conditions.append(
                f"(folder_path = {folder_param} "
                f"OR left(folder_path, char_length({folder_param}) + 1) = {folder_param} || '/')"
            )

        if doc_conditions:
            clause += (
                f" AND c.document_id IN ("
                f"SELECT id FROM {SCHEMA}.documents "
                f"WHERE org_slug = ${org_param} AND {' AND '.join(doc_conditions)})"
            )

        return clause, params

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
        org_slug: str,
        file_ids: list[str] | None,
        limit: int,
        folder_path: str | None = None,
    ) -> list[dict[str, Any]]:
        tenant_clause, tenant_params = self._build_scope_clause(org_slug, file_ids, 1, folder_path=folder_path)

        sql = f"""
            SELECT c.id, c.chunk_content, c.core_content, c.chunk_index, c.document_id,
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
        org_slug: str,
        file_ids: list[str] | None,
        limit: int,
        folder_path: str | None = None,
    ) -> list[dict[str, Any]]:
        vec_str = json.dumps(embedding)
        tenant_clause, tenant_params = self._build_scope_clause(org_slug, file_ids, 1, folder_path=folder_path)

        sql = f"""
            SELECT c.id, c.chunk_content, c.core_content, c.chunk_index, c.document_id,
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

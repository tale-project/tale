"""
Hybrid search service: BM25 full-text (pg_search) + pgvector similarity with RRF fusion.
"""

import asyncio
import json
import logging
from dataclasses import dataclass

import asyncpg

from app.org_context import get_active_org
from app.services.database import acquire_with_retry
from app.services.embedding_service import get_embedding_service

logger = logging.getLogger(__name__)

RRF_K = 60


@dataclass
class SearchResult:
    url: str
    title: str | None
    chunk_content: str
    chunk_index: int
    score: float
    # Part B Phase 1+: populated for chunks indexed after the refactor.
    # Empty string for legacy rows; consumers should prefer this field over
    # `chunk_content` once rollout completes.
    core_content: str = ""


class SearchService:
    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool

    async def search(
        self,
        query: str,
        domain: str | None = None,
        limit: int = 10,
        similarity_threshold: float = 0.4,
    ) -> list[SearchResult]:
        # Resolve the active org once and pass to both helpers — chunks
        # data is shared across orgs, but each search is restricted to
        # domains the caller's org has registered (membership filter).
        org_slug = get_active_org()

        # Generate query embedding and run both searches in parallel
        embedding_task = asyncio.create_task(get_embedding_service().embed_query(query))
        fts_task = asyncio.create_task(self._fts_search(query, org_slug, domain, limit * 3))

        query_embedding = await embedding_task
        fts_results = await fts_task
        vector_results = await self._vector_search(query_embedding, org_slug, domain, limit * 3)

        # Pre-filter vector results by cosine similarity (matches RAG pipeline).
        # If ALL vector results fall below the threshold the query is considered
        # semantically irrelevant — discard FTS results too (keyword noise).
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

        return self._merge_rrf([fts_results, vector_results], limit)

    async def _fts_search(self, query: str, org_slug: str, domain: str | None, limit: int) -> list[dict]:
        # Membership filter restricts the org's view to domains it has
        # registered. chunks/websites are deployment-shared content, but
        # org A must not see search hits from a domain only org B added.
        async with acquire_with_retry(self._pool) as conn:
            if domain:
                rows = await conn.fetch(
                    """SELECT c.id, c.url, c.title, c.chunk_content, c.core_content, c.chunk_index,
                              paradedb.score(c.id) AS score
                       FROM chunks c
                       WHERE c.id @@@ paradedb.match('chunk_content', $1)
                         AND c.domain = $2
                         AND EXISTS (
                             SELECT 1 FROM website_org_memberships m
                             WHERE m.domain = c.domain AND m.org_slug = $3
                         )
                       ORDER BY score DESC
                       LIMIT $4""",
                    query,
                    domain,
                    org_slug,
                    limit,
                )
            else:
                rows = await conn.fetch(
                    """SELECT c.id, c.url, c.title, c.chunk_content, c.core_content, c.chunk_index,
                              paradedb.score(c.id) AS score
                       FROM chunks c
                       WHERE c.id @@@ paradedb.match('chunk_content', $1)
                         AND EXISTS (
                             SELECT 1 FROM website_org_memberships m
                             WHERE m.domain = c.domain AND m.org_slug = $2
                         )
                       ORDER BY score DESC
                       LIMIT $3""",
                    query,
                    org_slug,
                    limit,
                )
            return [dict(r) for r in rows]

    async def _vector_search(self, embedding: list[float], org_slug: str, domain: str | None, limit: int) -> list[dict]:
        vec_str = json.dumps(embedding)
        async with acquire_with_retry(self._pool) as conn:
            if domain:
                rows = await conn.fetch(
                    """SELECT c.id, c.url, c.title, c.chunk_content, c.core_content, c.chunk_index,
                              1 - (c.embedding <=> $1::vector) AS score
                       FROM chunks c
                       WHERE c.domain = $2 AND c.embedding IS NOT NULL
                         AND EXISTS (
                             SELECT 1 FROM website_org_memberships m
                             WHERE m.domain = c.domain AND m.org_slug = $3
                         )
                       ORDER BY c.embedding <=> $1::vector
                       LIMIT $4""",
                    vec_str,
                    domain,
                    org_slug,
                    limit,
                )
            else:
                rows = await conn.fetch(
                    """SELECT c.id, c.url, c.title, c.chunk_content, c.core_content, c.chunk_index,
                              1 - (c.embedding <=> $1::vector) AS score
                       FROM chunks c
                       WHERE c.embedding IS NOT NULL
                         AND EXISTS (
                             SELECT 1 FROM website_org_memberships m
                             WHERE m.domain = c.domain AND m.org_slug = $2
                         )
                       ORDER BY c.embedding <=> $1::vector
                       LIMIT $3""",
                    vec_str,
                    org_slug,
                    limit,
                )
            return [dict(r) for r in rows]

    @staticmethod
    def _merge_rrf(ranked_lists: list[list[dict]], limit: int) -> list[SearchResult]:
        scores: dict[int, float] = {}
        items: dict[int, dict] = {}

        for ranked in ranked_lists:
            for rank, item in enumerate(ranked):
                item_id = item["id"]
                rrf_score = 1.0 / (RRF_K + rank + 1)
                scores[item_id] = scores.get(item_id, 0.0) + rrf_score
                items[item_id] = item

        sorted_ids = sorted(scores, key=lambda k: scores[k], reverse=True)[:limit]

        # Normalize against theoretical max so scores reflect absolute quality
        num_contributing = max(1, sum(1 for r in ranked_lists if r))
        max_score = num_contributing / (RRF_K + 1) if sorted_ids else 1.0

        return [
            SearchResult(
                url=items[item_id]["url"],
                title=items[item_id].get("title"),
                chunk_content=items[item_id]["chunk_content"],
                chunk_index=items[item_id]["chunk_index"],
                score=scores[item_id] / max_score,
                core_content=items[item_id].get("core_content") or "",
            )
            for item_id in sorted_ids
        ]

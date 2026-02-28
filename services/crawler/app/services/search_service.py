"""
Hybrid search service: BM25 full-text (pg_search) + pgvector similarity with RRF fusion.
"""

import asyncio
import json
import logging
from dataclasses import dataclass

import asyncpg

from app.services.database import acquire_with_retry
from tale_knowledge.embedding import EmbeddingService

logger = logging.getLogger(__name__)

RRF_K = 60


@dataclass
class SearchResult:
    url: str
    title: str | None
    chunk_content: str
    chunk_index: int
    score: float


class SearchService:
    def __init__(self, pool: asyncpg.Pool, embedding_service: EmbeddingService):
        self._pool = pool
        self._embedding = embedding_service

    async def search(
        self,
        query: str,
        domain: str | None = None,
        limit: int = 10,
    ) -> list[SearchResult]:
        # Generate query embedding and run both searches in parallel
        embedding_task = asyncio.create_task(self._embedding.embed_query(query))
        fts_task = asyncio.create_task(self._fts_search(query, domain, limit * 3))

        query_embedding = await embedding_task
        fts_results = await fts_task
        vector_results = await self._vector_search(query_embedding, domain, limit * 3)

        return self._merge_rrf([fts_results, vector_results], limit)

    async def _fts_search(self, query: str, domain: str | None, limit: int) -> list[dict]:
        async with acquire_with_retry(self._pool) as conn:
            if domain:
                rows = await conn.fetch(
                    """SELECT id, url, title, chunk_content, chunk_index,
                              paradedb.score(id) AS score
                       FROM chunks
                       WHERE id @@@ paradedb.match('chunk_content', $1) AND domain = $2
                       ORDER BY score DESC
                       LIMIT $3""",
                    query,
                    domain,
                    limit,
                )
            else:
                rows = await conn.fetch(
                    """SELECT id, url, title, chunk_content, chunk_index,
                              paradedb.score(id) AS score
                       FROM chunks
                       WHERE id @@@ paradedb.match('chunk_content', $1)
                       ORDER BY score DESC
                       LIMIT $2""",
                    query,
                    limit,
                )
            return [dict(r) for r in rows]

    async def _vector_search(self, embedding: list[float], domain: str | None, limit: int) -> list[dict]:
        vec_str = json.dumps(embedding)
        async with acquire_with_retry(self._pool) as conn:
            if domain:
                rows = await conn.fetch(
                    """SELECT id, url, title, chunk_content, chunk_index,
                              1 - (embedding <=> $1::vector) AS score
                       FROM chunks
                       WHERE domain = $2 AND embedding IS NOT NULL
                       ORDER BY embedding <=> $1::vector
                       LIMIT $3""",
                    vec_str,
                    domain,
                    limit,
                )
            else:
                rows = await conn.fetch(
                    """SELECT id, url, title, chunk_content, chunk_index,
                              1 - (embedding <=> $1::vector) AS score
                       FROM chunks
                       WHERE embedding IS NOT NULL
                       ORDER BY embedding <=> $1::vector
                       LIMIT $2""",
                    vec_str,
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

        # Normalize scores
        max_score = scores[sorted_ids[0]] if sorted_ids else 1.0

        return [
            SearchResult(
                url=items[item_id]["url"],
                title=items[item_id].get("title"),
                chunk_content=items[item_id]["chunk_content"],
                chunk_index=items[item_id]["chunk_index"],
                score=scores[item_id] / max_score,
            )
            for item_id in sorted_ids
        ]

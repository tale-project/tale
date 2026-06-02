"""pgvector-backed VectorStore driver (the built-in default).

Wraps the existing asyncpg + pgvector SQL. Selecting this backend keeps
RAG behavior identical to the pre-abstraction service: vectors live in
`private_knowledge.chunks.embedding`, written inline by the indexing
transaction, so `upsert`/`delete` are no-ops (chunk rows — and their
embeddings — are owned by indexing_service / FK CASCADE). `search` is the
ANN half of the old `_vector_search`, returning ids + score for the
caller to hydrate.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

import asyncpg
from tale_shared.db import acquire_with_retry

from ..database import pin_embedding_dimensions
from .base import VectorHit, VectorRecord

SCHEMA = "private_knowledge"


class PostgresVectorStore:
    backend_name = "pgvector"
    requires_index_sync = False

    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    async def ensure_ready(self, dimensions: int) -> None:
        # Pin the embedding column to vector(dimensions) + ensure the HNSW
        # index. This is exactly what the service did before the
        # abstraction; the pgvector driver simply owns the call now.
        await pin_embedding_dimensions(self._pool, dimensions)

    async def upsert(self, records: list[VectorRecord]) -> None:
        # No-op: the indexing transaction writes `chunks.embedding` inline.
        return None

    async def delete_documents(self, org_slug: str, document_ids: list[UUID]) -> None:
        # No-op: FK CASCADE removes chunk rows (and embeddings) on document delete.
        return None

    async def search(
        self,
        org_slug: str,
        embedding: list[float],
        *,
        file_ids: list[str] | None,
        limit: int,
    ) -> list[VectorHit]:
        vec_str = json.dumps(embedding)
        clause, params = self._scope_clause(org_slug, file_ids, 1)

        sql = f"""
            SELECT c.id, 1 - (c.embedding <=> $1::vector) AS score
            FROM {SCHEMA}.chunks c
            WHERE c.embedding IS NOT NULL
            {clause}
            ORDER BY c.embedding <=> $1::vector
            LIMIT ${2 + len(params)}
        """
        full_params = [vec_str, *params, limit]

        async with acquire_with_retry(self._pool) as conn:
            rows = await conn.fetch(sql, *full_params)
        return [VectorHit(chunk_id=r["id"], score=r["score"]) for r in rows]

    async def health(self) -> dict[str, Any]:
        try:
            async with acquire_with_retry(self._pool) as conn:
                await conn.fetchval("SELECT 1")
            return {"backend": self.backend_name, "reachable": True}
        except Exception:
            # Health probe must never raise — report unreachable instead.
            return {"backend": self.backend_name, "reachable": False}

    def _scope_clause(
        self,
        org_slug: str,
        file_ids: list[str] | None,
        param_offset: int,
    ) -> tuple[str, list[Any]]:
        """Per-tenant + optional file scoping for the ANN query.

        Mirrors `RagSearchService._build_scope_clause` (kept local so the
        driver is self-contained): `org_slug` is ALWAYS applied; `file_ids`
        narrows within the org via an org-scoped documents subquery.
        """
        org_param = param_offset + 1
        clause = f" AND c.org_slug = ${org_param}"
        params: list[Any] = [org_slug]

        if file_ids:
            file_param = param_offset + 2
            clause += (
                f" AND c.document_id IN ("
                f"SELECT id FROM {SCHEMA}.documents "
                f"WHERE org_slug = ${org_param} AND file_id = ANY(${file_param}))"
            )
            params.append(file_ids)

        return clause, params

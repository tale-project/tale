"""Qdrant-backed VectorStore driver.

Stores embedding vectors in a Qdrant collection keyed by `chunks.id`, with
`org_slug` + `document_id` in each point's payload. Chunk content and
document metadata stay in Postgres — the authoritative store and the
per-tenant isolation gate; this driver handles only ANN upsert/search/
delete.

The collection uses cosine distance (matching pgvector's
`vector_cosine_ops`), so the score Qdrant returns is already cosine
similarity in the `1 - distance` convention the rest of the pipeline
expects — no extra normalization.

`qdrant-client` is imported here (not at package top level) so the
built-in pgvector backend doesn't require the optional dependency.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg
from loguru import logger
from qdrant_client import AsyncQdrantClient, models
from tale_shared.db import acquire_with_retry

from .base import VectorHit, VectorRecord
from .config_reader import VectorDbConfig

SCHEMA = "private_knowledge"
_UPSERT_BATCH = 256


class QdrantVectorStore:
    backend_name = "qdrant"
    requires_index_sync = True

    def __init__(self, pool: asyncpg.Pool, config: VectorDbConfig) -> None:
        self._pool = pool
        self._collection = config.collection
        self._client = AsyncQdrantClient(
            url=config.qdrant_url,
            api_key=config.api_key,
            prefer_grpc=config.prefer_grpc,
            timeout=30,
        )

    async def ensure_ready(self, dimensions: int) -> None:
        created = False
        if not await self._client.collection_exists(self._collection):
            await self._client.create_collection(
                collection_name=self._collection,
                vectors_config=models.VectorParams(
                    size=dimensions,
                    distance=models.Distance.COSINE,
                ),
            )
            created = True
            logger.info(
                "Created Qdrant collection '{}' (size={}, cosine)",
                self._collection,
                dimensions,
            )

        # Payload indexes so the tenant + file filters are indexed lookups.
        # Idempotent: re-creating an existing index is a no-op server-side.
        for field in ("org_slug", "document_id"):
            try:
                await self._client.create_payload_index(
                    collection_name=self._collection,
                    field_name=field,
                    field_schema=models.PayloadSchemaType.KEYWORD,
                )
            except Exception as exc:
                # Benign when the index already exists; log so a genuine
                # schema problem is still visible in the RAG logs.
                logger.debug("Qdrant payload index ensure for '{}': {}", field, exc)

        if created:
            # First switch to Qdrant: copy existing vectors out of Postgres
            # (no re-embedding). One-time — subsequent indexing keeps Qdrant
            # in sync via the upsert hook. Imported here to avoid a cycle.
            from .backfill import backfill_vectors

            copied = await backfill_vectors(self._pool, self)
            if copied:
                logger.info("Backfilled {} existing vectors into new Qdrant collection", copied)

    async def upsert(self, records: list[VectorRecord]) -> None:
        if not records:
            return
        for start in range(0, len(records), _UPSERT_BATCH):
            batch = records[start : start + _UPSERT_BATCH]
            points = [
                models.PointStruct(
                    id=str(r.chunk_id),
                    vector=r.embedding,
                    payload={"org_slug": r.org_slug, "document_id": str(r.document_id)},
                )
                for r in batch
            ]
            await self._client.upsert(collection_name=self._collection, points=points, wait=True)

    async def search(
        self,
        org_slug: str,
        embedding: list[float],
        *,
        file_ids: list[str] | None,
        limit: int,
    ) -> list[VectorHit]:
        must: list[Any] = [
            models.FieldCondition(key="org_slug", match=models.MatchValue(value=org_slug)),
        ]
        if file_ids:
            # Resolve file_ids -> document UUIDs ORG-SCOPED IN SQL so the
            # Qdrant filter can never widen beyond this tenant's documents.
            document_ids = await self._resolve_document_ids(org_slug, file_ids)
            if not document_ids:
                return []
            must.append(
                models.FieldCondition(key="document_id", match=models.MatchAny(any=document_ids)),
            )

        response = await self._client.query_points(
            collection_name=self._collection,
            query=embedding,
            query_filter=models.Filter(must=must),
            limit=limit,
            with_payload=False,
            with_vectors=False,
        )
        return [VectorHit(chunk_id=UUID(str(p.id)), score=float(p.score)) for p in response.points]

    async def delete_documents(self, org_slug: str, document_ids: list[UUID]) -> None:
        if not document_ids:
            return
        await self._client.delete(
            collection_name=self._collection,
            points_selector=models.FilterSelector(
                filter=models.Filter(
                    must=[
                        models.FieldCondition(key="org_slug", match=models.MatchValue(value=org_slug)),
                        models.FieldCondition(
                            key="document_id",
                            match=models.MatchAny(any=[str(d) for d in document_ids]),
                        ),
                    ]
                )
            ),
            wait=True,
        )

    async def health(self) -> dict[str, Any]:
        try:
            info = await self._client.get_collection(self._collection)
            return {
                "backend": self.backend_name,
                "reachable": True,
                "collection": self._collection,
                "points": getattr(info, "points_count", None),
            }
        except Exception:
            return {"backend": self.backend_name, "reachable": False, "collection": self._collection}

    async def _resolve_document_ids(self, org_slug: str, file_ids: list[str]) -> list[str]:
        """Map external file_ids to internal document UUIDs, org-scoped."""
        async with acquire_with_retry(self._pool) as conn:
            rows = await conn.fetch(
                f"SELECT id FROM {SCHEMA}.documents WHERE org_slug = $1 AND file_id = ANY($2)",
                org_slug,
                file_ids,
            )
        return [str(r["id"]) for r in rows]

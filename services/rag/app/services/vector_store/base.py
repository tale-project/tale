"""Vector-store driver interface for the RAG service.

Only the ANN vector index is abstracted behind this protocol. Chunk
content, document metadata, per-tenant `org_slug` isolation, BM25/FTS,
content-hash dedup, and the semantic cache all remain in Postgres
regardless of the active backend. A driver stores and searches embedding
VECTORS keyed by `private_knowledge.chunks.id`; the caller hydrates the
chunk content / document metadata from Postgres by id.

This keeps tenant isolation enforced in SQL (the authoritative gate) and
lets the BM25 + vector results merge backend-agnostically through the
existing RRF layer.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable
from uuid import UUID


@dataclass(frozen=True, slots=True)
class VectorHit:
    """One ANN match: the chunk id and its similarity score.

    `score` is normalized to the cosine-similarity / ``1 - distance``
    convention used everywhere downstream (the vector pre-filter
    threshold and RRF merge), so drivers MUST map their native score into
    that range before returning.
    """

    chunk_id: UUID
    score: float


@dataclass(frozen=True, slots=True)
class VectorRecord:
    """A chunk vector to persist in the backend.

    Carries the `org_slug` and `document_id` that external backends index
    in their payload — `org_slug` is the isolation key, `document_id`
    backs the `file_ids` filter (resolved org-scoped in SQL, then matched
    against the payload). pgvector ignores all of this (vectors live in
    the `chunks` row).
    """

    chunk_id: UUID
    org_slug: str
    document_id: UUID
    embedding: list[float]


@runtime_checkable
class VectorStore(Protocol):
    """Pluggable ANN backend. Implementations: pgvector (built-in), Qdrant."""

    backend_name: str
    # Whether the indexing/delete paths must mirror vectors into this
    # backend. False for pgvector (vectors live in the chunk row, managed by
    # the indexing transaction + FK CASCADE), True for external stores like
    # Qdrant. Lets the hot path skip the extra Postgres read + upsert when
    # it would be a no-op.
    requires_index_sync: bool

    async def ensure_ready(self, dimensions: int) -> None:
        """Converge the backend to the pinned embedding dimensions.

        pgvector: ALTER the `chunks.embedding` column + (re)create the HNSW
        index. Qdrant: create the collection at ``size=dimensions`` with
        cosine distance + a payload index on ``org_slug``. Idempotent.
        """
        ...

    async def upsert(self, records: list[VectorRecord]) -> None:
        """Persist vectors for the given chunks.

        pgvector: no-op — the indexing transaction writes
        `chunks.embedding` inline (Postgres is the source of truth for
        vectors under every backend). Qdrant: upsert points keyed by
        ``chunk_id`` with ``org_slug`` + ``document_id`` in the payload.
        """
        ...

    async def search(
        self,
        org_slug: str,
        embedding: list[float],
        *,
        file_ids: list[str] | None,
        limit: int,
    ) -> list[VectorHit]:
        """Return the nearest ``limit`` chunks for ``org_slug`` (+ optional
        ``file_ids`` restriction), highest similarity first. Ids only — the
        caller hydrates content from Postgres."""
        ...

    async def delete_documents(self, org_slug: str, document_ids: list[UUID]) -> None:
        """Remove all vectors belonging to the given documents.

        Keyed on `document_id` (stable across re-index) rather than chunk
        id, since re-indexing rotates chunk ids. pgvector: no-op — FK
        CASCADE drops `chunks` rows (and their embeddings) on document
        delete. Qdrant: delete points by an `org_slug` + `document_id`
        payload filter.
        """
        ...

    async def health(self) -> dict[str, Any]:
        """Backend liveness for the `/config` endpoint."""
        ...

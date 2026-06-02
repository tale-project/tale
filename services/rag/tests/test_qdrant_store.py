"""Unit tests for the Qdrant vector-store driver.

Uses qdrant-client's in-memory (`:memory:`) local mode — no server needed.
Covers tenant isolation via payload filter, search scoring/order, delete,
and ensure_ready idempotency. The `file_ids` path (which hits Postgres via
`_resolve_document_ids`) is exercised in integration tests, not here.
"""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from qdrant_client import AsyncQdrantClient, models

from app.services.vector_store import VectorRecord
from app.services.vector_store.config_reader import VectorDbConfig
from app.services.vector_store.qdrant_store import QdrantVectorStore

COLLECTION = "test_chunks"

# chunks.id is a BIGINT (Python int), NOT a UUID. Fixtures MUST use int chunk
# ids — using uuid.uuid4() here would round-trip cleanly and hide the real
# Qdrant point-id break (a numeric string is rejected; UUID(str(int)) raises).
_next_chunk = iter(range(10_000_000_001, 10_000_100_000))


def _chunk_id() -> int:
    return next(_next_chunk)


def _make_store() -> QdrantVectorStore:
    cfg = VectorDbConfig(backend="qdrant", qdrant_url="http://unused:6333", collection=COLLECTION)
    store = QdrantVectorStore(pool=MagicMock(), config=cfg)
    # Swap the network client for an in-memory one.
    store._client = AsyncQdrantClient(location=":memory:")
    return store


async def _create_collection(store: QdrantVectorStore, dim: int = 4) -> None:
    await store._client.create_collection(
        collection_name=COLLECTION,
        vectors_config=models.VectorParams(size=dim, distance=models.Distance.COSINE),
    )


def _pool_with_chunk_count(n: int):
    """Fake `acquire_with_retry` ctx whose conn.fetchval -> n (source chunks)."""
    conn = AsyncMock()
    conn.fetchval = AsyncMock(return_value=n)
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=conn)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return ctx


@pytest.mark.asyncio
async def test_search_isolates_by_org():
    store = _make_store()
    await _create_collection(store)

    a_chunk, a_doc = _chunk_id(), uuid.uuid4()
    b_chunk, b_doc = _chunk_id(), uuid.uuid4()
    await store.upsert(
        [
            VectorRecord(chunk_id=a_chunk, org_slug="orga", document_id=a_doc, embedding=[1.0, 0.0, 0.0, 0.0]),
            VectorRecord(chunk_id=b_chunk, org_slug="orgb", document_id=b_doc, embedding=[1.0, 0.0, 0.0, 0.0]),
        ]
    )

    hits_a = await store.search("orga", [1.0, 0.0, 0.0, 0.0], file_ids=None, limit=10)
    assert [h.chunk_id for h in hits_a] == [a_chunk]
    # The BIGINT chunk id must round-trip as an int (not a UUID/str).
    assert isinstance(hits_a[0].chunk_id, int)

    hits_b = await store.search("orgb", [1.0, 0.0, 0.0, 0.0], file_ids=None, limit=10)
    assert [h.chunk_id for h in hits_b] == [b_chunk]

    # Cosine of identical vectors ≈ 1.0 (the `1 - distance` convention).
    assert hits_a[0].score == pytest.approx(1.0, abs=1e-5)


@pytest.mark.asyncio
async def test_search_orders_by_similarity():
    store = _make_store()
    await _create_collection(store)

    near, far = _chunk_id(), _chunk_id()
    doc = uuid.uuid4()
    await store.upsert(
        [
            VectorRecord(chunk_id=near, org_slug="orga", document_id=doc, embedding=[1.0, 0.0, 0.0, 0.0]),
            VectorRecord(chunk_id=far, org_slug="orga", document_id=doc, embedding=[0.0, 1.0, 0.0, 0.0]),
        ]
    )

    hits = await store.search("orga", [1.0, 0.0, 0.0, 0.0], file_ids=None, limit=10)
    assert [h.chunk_id for h in hits] == [near, far]
    assert hits[0].score > hits[1].score


@pytest.mark.asyncio
async def test_delete_documents_removes_points():
    store = _make_store()
    await _create_collection(store)

    doc = uuid.uuid4()
    keep_doc = uuid.uuid4()
    c1, c2, c_keep = _chunk_id(), _chunk_id(), _chunk_id()
    await store.upsert(
        [
            VectorRecord(chunk_id=c1, org_slug="orga", document_id=doc, embedding=[1.0, 0.0, 0.0, 0.0]),
            VectorRecord(chunk_id=c2, org_slug="orga", document_id=doc, embedding=[0.9, 0.1, 0.0, 0.0]),
            VectorRecord(chunk_id=c_keep, org_slug="orga", document_id=keep_doc, embedding=[1.0, 0.0, 0.0, 0.0]),
        ]
    )

    await store.delete_documents("orga", [doc])

    # Both chunks of `doc` are gone; the other document's chunk survives.
    remaining = await store.search("orga", [1.0, 0.0, 0.0, 0.0], file_ids=None, limit=10)
    assert [h.chunk_id for h in remaining] == [c_keep]


@pytest.mark.asyncio
async def test_ensure_ready_idempotent_and_health(monkeypatch):
    store = _make_store()

    # New-collection branch triggers a backfill; stub it (no Postgres here).
    async def _fake_backfill(pool, s, **kwargs):
        return 0

    monkeypatch.setattr("app.services.vector_store.backfill.backfill_vectors", _fake_backfill)

    # Source chunk count == 0, so the second call's reconcile gate sees the
    # (empty) collection as fully populated and stays a no-op.
    with patch(
        "app.services.vector_store.qdrant_store.acquire_with_retry",
        return_value=_pool_with_chunk_count(0),
    ):
        await store.ensure_ready(4)  # creates the collection + payload indexes
        await store.ensure_ready(4)  # second call must be a no-op, not an error

    assert await store._client.collection_exists(COLLECTION)
    health = await store.health()
    assert health["backend"] == "qdrant"
    assert health["reachable"] is True
    assert health["collection"] == COLLECTION


@pytest.mark.asyncio
async def test_ensure_ready_reconciles_underpopulated_collection(monkeypatch):
    """An existing-but-under-populated collection must re-run the backfill
    (covers an interrupted first backfill or a switch-away-then-back)."""
    store = _make_store()
    await _create_collection(store)  # exists + empty (0 points)

    calls = {"backfill": 0}

    async def _fake_backfill(pool, s, **kwargs):
        calls["backfill"] += 1
        return 3

    monkeypatch.setattr("app.services.vector_store.backfill.backfill_vectors", _fake_backfill)

    # Postgres reports 3 source chunks vs 0 points in Qdrant -> reconcile.
    with patch(
        "app.services.vector_store.qdrant_store.acquire_with_retry",
        return_value=_pool_with_chunk_count(3),
    ):
        await store.ensure_ready(4)

    assert calls["backfill"] == 1


@pytest.mark.asyncio
async def test_ensure_ready_raises_on_dimension_mismatch():
    """An existing collection whose vector size differs from the pinned dims
    must fail loudly rather than silently search a wrong-dimension index."""
    store = _make_store()
    await _create_collection(store, dim=4)

    with pytest.raises(RuntimeError, match="vector size"):
        await store.ensure_ready(8)


@pytest.mark.asyncio
async def test_upsert_empty_is_noop():
    store = _make_store()
    await _create_collection(store)
    await store.upsert([])  # must not raise
    assert await store.search("orga", [1.0, 0.0, 0.0, 0.0], file_ids=None, limit=10) == []

"""Tests for switch-time vector backfill.

When an org switches its vector backend, the freshly-built external store starts
empty. Instead of forcing a manual re-index, `RagService` enqueues an org-scoped
backfill (flags the org's completed docs `vector_sync_pending`) and the reconcile
loop copies their existing `chunks.embedding` vectors into the new backend. These
tests cover the switch trigger + gating, the enqueue SQL, the drain-to-empty /
back-off loop behaviour, and the embedding-dimension guard that stops a
model-changed corpus from looping forever.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.config import settings
from app.services.rag_service import RagService, _VectorDimensionMismatch

pytestmark = pytest.mark.asyncio


def _patch_embedding_dims(dims: int = 1536):
    # `settings` is a pydantic instance that blocks attribute patching; patch the
    # inherited method on its class instead.
    return patch.object(type(settings), "get_embedding_config", return_value=("u", "k", "m", dims))


def _async_ctx(conn):
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=conn)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return ctx


def _make_service(*, requires_index_sync: bool = True):
    svc = RagService()
    svc.initialized = True
    svc._pool = MagicMock()
    store = MagicMock()
    store.requires_index_sync = requires_index_sync
    store.backend_name = "qdrant"
    clients = MagicMock()
    clients.vector_store = store
    svc._ensure_org_clients = AsyncMock(return_value=clients)
    return svc


def _store(requires_index_sync: bool = True, backend_name: str = "qdrant"):
    store = MagicMock()
    store.requires_index_sync = requires_index_sync
    store.backend_name = backend_name
    return store


# --------------------------------------------------------------------------- #
# _enqueue_full_backfill
# --------------------------------------------------------------------------- #


async def test_enqueue_full_backfill_flags_completed_docs_and_returns_count():
    svc = _make_service()
    conn = AsyncMock()
    conn.execute = AsyncMock(return_value="UPDATE 7")
    with patch("app.services.rag_service.acquire_with_retry", return_value=_async_ctx(conn)):
        flagged = await svc._enqueue_full_backfill("orga")

    assert flagged == 7
    sql, arg = conn.execute.await_args.args
    assert "vector_sync_pending = TRUE" in sql
    assert "status = 'completed'" in sql
    assert "org_slug = $1" in sql
    assert arg == "orga"


async def test_enqueue_full_backfill_handles_unexpected_tag():
    svc = _make_service()
    conn = AsyncMock()
    conn.execute = AsyncMock(return_value=None)
    with patch("app.services.rag_service.acquire_with_retry", return_value=_async_ctx(conn)):
        assert await svc._enqueue_full_backfill("orga") == 0


# --------------------------------------------------------------------------- #
# _maybe_backfill_on_switch — gating
# --------------------------------------------------------------------------- #


async def test_switch_to_external_enqueues_backfill_and_wakes_loop():
    svc = _make_service()
    svc._enqueue_full_backfill = AsyncMock(return_value=5)
    previous = MagicMock()  # a real prior client set => not a cold start

    flagged = await svc._maybe_backfill_on_switch(
        "orga", previous=previous, reuse_store=False, store=_store(requires_index_sync=True)
    )

    assert flagged == 5
    svc._enqueue_full_backfill.assert_awaited_once_with("orga")
    assert svc._get_reconcile_wake().is_set()


async def test_cold_start_does_not_enqueue_backfill():
    # previous is None (process restart / first build): must NOT re-flag everything.
    svc = _make_service()
    svc._enqueue_full_backfill = AsyncMock(return_value=99)

    flagged = await svc._maybe_backfill_on_switch(
        "orga", previous=None, reuse_store=False, store=_store(requires_index_sync=True)
    )

    assert flagged == 0
    svc._enqueue_full_backfill.assert_not_awaited()
    assert not svc._get_reconcile_wake().is_set()


async def test_reused_store_does_not_enqueue_backfill():
    # Only the LLM/provider config changed (reuse_store=True) — the vectordb
    # config is unchanged, so there is nothing to backfill.
    svc = _make_service()
    svc._enqueue_full_backfill = AsyncMock(return_value=99)

    flagged = await svc._maybe_backfill_on_switch(
        "orga", previous=MagicMock(), reuse_store=True, store=_store(requires_index_sync=True)
    )

    assert flagged == 0
    svc._enqueue_full_backfill.assert_not_awaited()


async def test_switch_to_builtin_pgvector_does_not_enqueue_backfill():
    # Switching BACK to built-in pgvector needs no copy: chunks.embedding is
    # already authoritative (requires_index_sync=False).
    svc = _make_service()
    svc._enqueue_full_backfill = AsyncMock(return_value=99)

    flagged = await svc._maybe_backfill_on_switch(
        "orga",
        previous=MagicMock(),
        reuse_store=False,
        store=_store(requires_index_sync=False, backend_name="pgvector"),
    )

    assert flagged == 0
    svc._enqueue_full_backfill.assert_not_awaited()


async def test_switch_does_not_wake_when_no_docs_flagged():
    # A genuine switch on an org with zero completed docs: no wake (nothing to do).
    svc = _make_service()
    svc._enqueue_full_backfill = AsyncMock(return_value=0)

    await svc._maybe_backfill_on_switch(
        "orga", previous=MagicMock(), reuse_store=False, store=_store(requires_index_sync=True)
    )

    assert not svc._get_reconcile_wake().is_set()


# --------------------------------------------------------------------------- #
# _sync_document_vectors — dimension guard
# --------------------------------------------------------------------------- #


async def test_sync_document_vectors_raises_on_dimension_mismatch():
    svc = _make_service()
    store = AsyncMock()
    store.backend_name = "qdrant"
    conn = AsyncMock()
    conn.fetchrow = AsyncMock(return_value={"id": "doc-1"})
    conn.fetch = AsyncMock(return_value=[{"id": 1, "embedding": "[0.1, 0.2]"}])  # 2-dim

    with (
        patch("app.services.rag_service.acquire_with_retry", return_value=_async_ctx(conn)),
        pytest.raises(_VectorDimensionMismatch),
    ):
        await svc._sync_document_vectors("orga", "f1", store, expected_dims=1536)

    store.upsert.assert_not_awaited()  # never mirror a wrong-width vector


async def test_sync_document_vectors_upserts_when_dims_match():
    svc = _make_service()
    store = AsyncMock()
    store.backend_name = "qdrant"
    conn = AsyncMock()
    conn.fetchrow = AsyncMock(return_value={"id": "doc-1"})
    conn.fetch = AsyncMock(return_value=[{"id": 1, "embedding": "[0.1, 0.2, 0.3]"}])  # 3-dim

    with patch("app.services.rag_service.acquire_with_retry", return_value=_async_ctx(conn)):
        await svc._sync_document_vectors("orga", "f1", store, expected_dims=3)

    store.upsert.assert_awaited_once()


# --------------------------------------------------------------------------- #
# _reconcile_pending_vectors — dimension-mismatch clears the flag (no infinite retry)
# --------------------------------------------------------------------------- #


async def test_reconcile_clears_flag_on_dimension_mismatch():
    svc = _make_service()
    select_conn = AsyncMock()
    select_conn.fetch = AsyncMock(return_value=[{"org_slug": "orga", "file_id": "f1"}])
    clear_conn = AsyncMock()
    svc._sync_document_vectors = AsyncMock(side_effect=_VectorDimensionMismatch("dim drift"))

    with (
        _patch_embedding_dims(),
        patch(
            "app.services.rag_service.acquire_with_retry",
            side_effect=[_async_ctx(select_conn), _async_ctx(clear_conn)],
        ),
    ):
        selected, cleared = await svc._reconcile_pending_vectors()

    assert (selected, cleared) == (1, 1)
    assert "vector_sync_pending = FALSE" in clear_conn.execute.await_args.args[0]


async def test_reconcile_returns_counts():
    svc = _make_service()
    pending = [{"org_slug": "orga", "file_id": "f1"}, {"org_slug": "orga", "file_id": "f2"}]
    select_conn = AsyncMock()
    select_conn.fetch = AsyncMock(return_value=pending)
    clear_conn = AsyncMock()
    svc._sync_document_vectors = AsyncMock()

    with (
        _patch_embedding_dims(),
        patch(
            "app.services.rag_service.acquire_with_retry",
            side_effect=[_async_ctx(select_conn), _async_ctx(clear_conn), _async_ctx(clear_conn)],
        ),
    ):
        selected, cleared = await svc._reconcile_pending_vectors()

    assert (selected, cleared) == (2, 2)


# --------------------------------------------------------------------------- #
# _vector_sync_reconcile_loop — drain-to-empty vs back-off
# --------------------------------------------------------------------------- #


async def test_loop_drains_to_empty_while_full_batches_make_progress():
    from app.services import rag_service as mod

    svc = _make_service()
    svc._get_reconcile_wake().set()  # wake immediately, skip the interval wait
    batch = mod._VECTOR_RECONCILE_BATCH
    seq = iter([(batch, batch), (batch, batch), (10, 10)])
    calls = {"n": 0}

    async def fake_reconcile():
        calls["n"] += 1
        try:
            result = next(seq)
        except StopIteration:  # pragma: no cover - safety
            svc._shutting_down = True
            return (0, 0)
        if result == (10, 10):
            svc._shutting_down = True  # exit the outer loop after the short batch
        return result

    svc._reconcile_pending_vectors = fake_reconcile
    await svc._vector_sync_reconcile_loop()

    # Two full batches re-drained immediately; the short batch stopped the drain.
    assert calls["n"] == 3


async def test_loop_backs_off_when_no_progress_despite_full_batch():
    from app.services import rag_service as mod

    svc = _make_service()
    svc._get_reconcile_wake().set()
    batch = mod._VECTOR_RECONCILE_BATCH
    calls = {"n": 0}

    async def fake_reconcile():
        calls["n"] += 1
        svc._shutting_down = True  # exit the outer loop after this pass
        return (batch, 0)  # full batch, nothing cleared (e.g. backend down)

    svc._reconcile_pending_vectors = fake_reconcile
    await svc._vector_sync_reconcile_loop()

    # cleared==0 => did NOT immediately re-drain despite a full batch.
    assert calls["n"] == 1

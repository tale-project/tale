"""Tests for external-backend vector-sync drift handling.

Covers the marker + opportunistic reconcile that keep Postgres (source of
truth) and an external vector backend (e.g. Qdrant) converged when a live
mirror sync fails — without ever flipping an already-indexed document to
failed.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytestmark = pytest.mark.asyncio


def _async_ctx(conn):
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=conn)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return ctx


def _make_service(*, requires_index_sync: bool = True):
    from app.services.rag_service import RagService

    svc = RagService()
    svc.initialized = True
    svc._pool = MagicMock()
    store = MagicMock()
    store.requires_index_sync = requires_index_sync
    store.backend_name = "qdrant"
    svc._vector_store = store
    return svc


async def test_mark_vector_sync_pending_sets_flag():
    svc = _make_service()
    conn = AsyncMock()
    with patch("app.services.rag_service.acquire_with_retry", return_value=_async_ctx(conn)):
        await svc._mark_vector_sync_pending("orga", "file-1")
    conn.execute.assert_awaited_once()
    assert "vector_sync_pending = TRUE" in conn.execute.await_args.args[0]


async def test_reconcile_resyncs_pending_and_clears_flag():
    svc = _make_service()
    pending = [{"org_slug": "orga", "file_id": "f1"}, {"org_slug": "orgb", "file_id": "f2"}]
    select_conn = AsyncMock()
    select_conn.fetch = AsyncMock(return_value=pending)
    clear_conn = AsyncMock()
    svc._sync_document_vectors = AsyncMock()

    # acquire order: 1 select, then one clear per successfully synced doc.
    with patch(
        "app.services.rag_service.acquire_with_retry",
        side_effect=[_async_ctx(select_conn), _async_ctx(clear_conn), _async_ctx(clear_conn)],
    ):
        await svc._reconcile_pending_vectors()

    assert svc._sync_document_vectors.await_count == 2
    assert clear_conn.execute.await_count == 2
    assert "vector_sync_pending = FALSE" in clear_conn.execute.await_args.args[0]


async def test_reconcile_leaves_flag_set_when_sync_fails():
    svc = _make_service()
    select_conn = AsyncMock()
    select_conn.fetch = AsyncMock(return_value=[{"org_slug": "orga", "file_id": "f1"}])
    svc._sync_document_vectors = AsyncMock(side_effect=RuntimeError("qdrant unreachable"))

    # Only the select acquire happens; a failed sync must NOT clear the flag.
    with patch("app.services.rag_service.acquire_with_retry", side_effect=[_async_ctx(select_conn)]):
        await svc._reconcile_pending_vectors()

    svc._sync_document_vectors.assert_awaited_once()


async def test_reconcile_noop_for_pgvector_backend():
    svc = _make_service(requires_index_sync=False)
    svc._sync_document_vectors = AsyncMock()
    with patch("app.services.rag_service.acquire_with_retry") as acquire:
        await svc._reconcile_pending_vectors()
    acquire.assert_not_called()
    svc._sync_document_vectors.assert_not_awaited()

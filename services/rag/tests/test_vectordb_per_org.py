"""Per-org vector-store selection, dimension pinning, and lifecycle.

Drives `_build_or_refresh_org_clients` with the build dependencies mocked so
the per-org store selection, the built-in-vs-external dimension-pin split, and
the close-on-eviction / close-on-backend-switch lifecycle are all exercised
without a real database or vector backend.
"""

from __future__ import annotations

import asyncio
import contextlib
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.vector_store import VectorDbConfig

pytestmark = pytest.mark.asyncio


def _llm_config():
    return {
        "model": "gpt",
        "embedding_model": "embed",
        "embedding_base_url": "http://e",
        "base_url": "http://c",
        "api_key": "k",
        "embedding_api_key": "k",
    }


def _store(*, backend_name: str, requires_index_sync: bool):
    store = AsyncMock()
    store.backend_name = backend_name
    store.requires_index_sync = requires_index_sync
    return store


@contextlib.contextmanager
def _patched_service(*, dims_by_org, store_by_org, vectordb_by_org, llm_factory=None):
    """Yield a RagService with per-org build dependencies mocked.

    The lookup dicts are read at call time, so a test may mutate them between
    `_ensure_org_clients` calls to simulate a runtime config change.
    `llm_factory(org)` overrides the per-org LLM config (default: a fixed dict),
    letting a test vary the LLM config while holding vectordb config constant.
    """
    from app.services.rag_service import RagService

    svc = RagService()
    svc.initialized = True
    svc._pool = MagicMock()

    settings_mock = MagicMock()
    settings_mock.get_llm_config.side_effect = llm_factory or (lambda org: _llm_config())
    settings_mock.get_embedding_config.side_effect = lambda org: (None, None, None, dims_by_org[org])
    settings_mock.get_vision_config.side_effect = lambda org: (_ for _ in ()).throw(ValueError("no vision"))

    with (
        patch("app.services.rag_service.settings", settings_mock),
        patch("app.services.rag_service.EmbeddingService", MagicMock(return_value=AsyncMock())),
        patch("app.services.rag_service.AsyncOpenAI", MagicMock(return_value=AsyncMock())),
        patch("app.services.rag_service.RagSearchService", MagicMock(return_value=MagicMock())),
        patch(
            "app.services.rag_service.get_vector_store",
            side_effect=lambda pool, config=None, org_slug=None: store_by_org[org_slug],
        ),
        patch("app.services.rag_service.load_vectordb_config", side_effect=lambda org: vectordb_by_org[org]),
    ):
        yield svc


async def test_per_org_store_selection_and_dim_split():
    builtin = _store(backend_name="pgvector", requires_index_sync=False)
    external = _store(backend_name="qdrant", requires_index_sync=True)
    with _patched_service(
        dims_by_org={"a": 768, "b": 1536},
        store_by_org={"a": builtin, "b": external},
        vectordb_by_org={
            "a": VectorDbConfig(),
            "b": VectorDbConfig(backend="qdrant", qdrant_url="http://q"),
        },
    ) as svc:
        ca = await svc._ensure_org_clients("a")
        cb = await svc._ensure_org_clients("b")

    assert ca.vector_store is builtin
    assert cb.vector_store is external
    # External org pins its own dims; built-in org pins the shared column.
    external.ensure_ready.assert_awaited_once_with(1536)
    builtin.ensure_ready.assert_awaited_once_with(768)
    # Only the built-in org sets the global (shared-column) pin.
    assert svc._pinned_dims == 768


async def test_external_orgs_may_use_different_dims():
    ext_a = _store(backend_name="qdrant", requires_index_sync=True)
    ext_b = _store(backend_name="qdrant", requires_index_sync=True)
    with _patched_service(
        dims_by_org={"a": 1536, "b": 768},
        store_by_org={"a": ext_a, "b": ext_b},
        vectordb_by_org={
            "a": VectorDbConfig(backend="qdrant", qdrant_url="http://qa"),
            "b": VectorDbConfig(backend="qdrant", qdrant_url="http://qb"),
        },
    ) as svc:
        await svc._ensure_org_clients("a")
        await svc._ensure_org_clients("b")

    ext_a.ensure_ready.assert_awaited_once_with(1536)
    ext_b.ensure_ready.assert_awaited_once_with(768)
    # External backends never touch the shared column → no global pin.
    assert svc._pinned_dims is None


async def test_two_builtin_orgs_must_agree_on_dims():
    a = _store(backend_name="pgvector", requires_index_sync=False)
    b = _store(backend_name="pgvector", requires_index_sync=False)
    with _patched_service(
        dims_by_org={"a": 768, "b": 1536},
        store_by_org={"a": a, "b": b},
        vectordb_by_org={"a": VectorDbConfig(), "b": VectorDbConfig()},
    ) as svc:
        await svc._ensure_org_clients("a")
        with pytest.raises(ValueError, match="do not match"):
            await svc._ensure_org_clients("b")


async def test_eviction_closes_vector_store(monkeypatch):
    from app.services import rag_service as rag_mod

    monkeypatch.setattr(rag_mod, "_ORG_LOCKS_MAX", 1)
    s1 = _store(backend_name="qdrant", requires_index_sync=True)
    s2 = _store(backend_name="qdrant", requires_index_sync=True)
    with _patched_service(
        dims_by_org={"a": 1536, "b": 1536},
        store_by_org={"a": s1, "b": s2},
        vectordb_by_org={
            "a": VectorDbConfig(backend="qdrant", qdrant_url="http://qa"),
            "b": VectorDbConfig(backend="qdrant", qdrant_url="http://qb"),
        },
    ) as svc:
        # Make _safe_close run its close immediately instead of waiting 30s.
        rag_mod._get_shutdown_event().set()
        rag_mod._background_tasks.clear()
        try:
            await svc._ensure_org_clients("a")
            await svc._ensure_org_clients("b")  # cap=1 → evicts "a"
            await asyncio.gather(*list(rag_mod._background_tasks), return_exceptions=True)
            s1.close.assert_awaited_once()
        finally:
            rag_mod._get_shutdown_event().clear()
            rag_mod._background_tasks.clear()


async def test_runtime_backend_switch_rebuilds_and_closes_old():
    from app.services import rag_service as rag_mod

    old = _store(backend_name="pgvector", requires_index_sync=False)
    new = _store(backend_name="qdrant", requires_index_sync=True)
    store_by_org = {"a": old}
    vectordb_by_org = {"a": VectorDbConfig()}
    with _patched_service(
        dims_by_org={"a": 768},
        store_by_org=store_by_org,
        vectordb_by_org=vectordb_by_org,
    ) as svc:
        c1 = await svc._ensure_org_clients("a")
        assert c1.vector_store is old

        # Switch the org's backend at runtime: the factory now returns `new`
        # and the resolved config differs. Dims must stay compatible for the
        # new external store (768).
        store_by_org["a"] = new
        vectordb_by_org["a"] = VectorDbConfig(backend="qdrant", qdrant_url="http://q")
        # Bypass the 15s refresh gate to force a rebuild on the next call.
        svc._org_clients["a"].last_check = 0

        rag_mod._get_shutdown_event().set()
        rag_mod._background_tasks.clear()
        try:
            c2 = await svc._ensure_org_clients("a")
            assert c2.vector_store is new
            await asyncio.gather(*list(rag_mod._background_tasks), return_exceptions=True)
            old.close.assert_awaited_once()
        finally:
            rag_mod._get_shutdown_event().clear()
            rag_mod._background_tasks.clear()


async def test_store_reused_when_only_llm_config_changes():
    # When the vectordb config is unchanged, the existing store must be reused
    # (not rebuilt/closed) even though the LLM provider config changed.
    store = _store(backend_name="qdrant", requires_index_sync=True)
    models = iter(["gpt-old", "gpt-new"])

    def _changing_llm(org):
        cfg = _llm_config()
        cfg["model"] = next(models)  # different content each call → llm changed
        return cfg

    with _patched_service(
        dims_by_org={"a": 1536},
        store_by_org={"a": store},
        vectordb_by_org={"a": VectorDbConfig(backend="qdrant", qdrant_url="http://q")},
        llm_factory=_changing_llm,
    ) as svc:
        c1 = await svc._ensure_org_clients("a")
        # Force the refresh path; the second build sees a changed llm config but
        # an unchanged vectordb config → rebuild clients, REUSE the store.
        svc._org_clients["a"].last_check = 0
        c2 = await svc._ensure_org_clients("a")

    assert c1.vector_store is store
    assert c2.vector_store is store
    # The store must NOT be closed when it is reused across an LLM-only refresh.
    store.close.assert_not_awaited()

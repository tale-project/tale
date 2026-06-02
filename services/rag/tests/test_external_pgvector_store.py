"""Unit tests for the external-pgvector vector-store driver.

The SQL-executing paths (ensure_ready/upsert/search against a live external
Postgres) are integration territory — no in-memory Postgres exists. These
tests cover what is verifiable without a server: config/identifier validation,
the empty-input no-ops, the org-scoped early return, and the parameter ordering
of the search query (which is hand-rolled around an optional file filter).
"""

import json
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.vector_store import VectorRecord
from app.services.vector_store.config_reader import VectorDbConfig
from app.services.vector_store.external_pgvector_store import ExternalPgvectorStore

_MODULE = "app.services.vector_store.external_pgvector_store"


def _cfg(**overrides) -> VectorDbConfig:
    base = {
        "backend": "pgvector_external",
        "pg_host": "db.example.com",
        "pg_port": 5432,
        "pg_database": "tale",
        "pg_user": "tale_rw",
        "pg_sslmode": "require",
        "pg_table": "tale_vectors",
        "pg_password": "pw",
    }
    base.update(overrides)
    return VectorDbConfig(**base)


def _make_store(**overrides) -> ExternalPgvectorStore:
    return ExternalPgvectorStore(pool=MagicMock(), config=_cfg(**overrides))


class _Conn:
    """Minimal async connection double recording fetch/execute calls."""

    def __init__(self, fetch_impl):
        self._fetch_impl = fetch_impl
        self.calls: list[tuple[str, list]] = []

    async def fetch(self, sql, *params):
        self.calls.append((sql, list(params)))
        return await self._fetch_impl(sql, list(params))


def _ctx(conn: _Conn):
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=conn)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return ctx


def test_attributes():
    store = _make_store()
    assert store.backend_name == "pgvector_external"
    assert store.requires_index_sync is True


def test_rejects_invalid_table_identifier():
    with pytest.raises(ValueError, match="table identifier"):
        _make_store(pg_table="drop table; --")


def test_rejects_missing_connection_fields():
    with pytest.raises(ValueError):
        ExternalPgvectorStore(pool=MagicMock(), config=_cfg(pg_host=None))


def test_table_is_public_qualified():
    store = _make_store(pg_table="kb_vectors")
    assert store._table == "public.kb_vectors"


@pytest.mark.asyncio
async def test_upsert_empty_is_noop_without_connecting():
    store = _make_store()
    store._get_ext_pool = AsyncMock()
    await store.upsert([])
    store._get_ext_pool.assert_not_awaited()


@pytest.mark.asyncio
async def test_delete_empty_is_noop_without_connecting():
    store = _make_store()
    store._get_ext_pool = AsyncMock()
    await store.delete_documents("orga", [])
    store._get_ext_pool.assert_not_awaited()


@pytest.mark.asyncio
async def test_search_with_unresolvable_file_ids_returns_empty():
    """file_ids resolving to no org-owned documents short-circuits to [] and
    never touches the external pool (the built-in DB is the tenant gate)."""
    store = _make_store()
    store._get_ext_pool = AsyncMock()

    async def _fetch(_sql, _params):
        return []  # _resolve_document_ids finds nothing for this org

    with patch(f"{_MODULE}.acquire_with_retry", return_value=_ctx(_Conn(_fetch))):
        hits = await store.search("orga", [1.0, 0.0], file_ids=["missing"], limit=10)

    assert hits == []
    store._get_ext_pool.assert_not_awaited()


@pytest.mark.asyncio
async def test_search_param_order_without_file_ids():
    store = _make_store()
    store._get_ext_pool = AsyncMock(return_value=MagicMock())

    async def _fetch(_sql, _params):
        return [{"id": 7, "score": 0.9}]

    conn = _Conn(_fetch)
    with patch(f"{_MODULE}.acquire_with_retry", return_value=_ctx(conn)):
        hits = await store.search("orga", [1.0, 0.0], file_ids=None, limit=10)

    assert [(h.chunk_id, h.score) for h in hits] == [(7, 0.9)]
    sql, params = conn.calls[-1]
    assert params == [json.dumps([1.0, 0.0]), "orga", 10]
    assert "LIMIT $3" in sql
    assert "uuid[]" not in sql  # no file filter clause


@pytest.mark.asyncio
async def test_search_param_order_with_file_ids():
    store = _make_store()
    store._get_ext_pool = AsyncMock(return_value=MagicMock())
    doc = uuid.uuid4()

    async def _fetch(sql, _params):
        if "private_knowledge.documents" in sql:
            return [{"id": doc}]  # _resolve_document_ids
        return [{"id": 11, "score": 0.5}]

    conn = _Conn(_fetch)
    with patch(f"{_MODULE}.acquire_with_retry", return_value=_ctx(conn)):
        hits = await store.search("orga", [0.0, 1.0], file_ids=["f1"], limit=5)

    assert [(h.chunk_id, h.score) for h in hits] == [(11, 0.5)]
    # Last call is the external ANN query; the doc filter is $3, limit is $4.
    sql, params = conn.calls[-1]
    assert params == [json.dumps([0.0, 1.0]), "orga", [doc], 5]
    assert "document_id = ANY($3::uuid[])" in sql
    assert "LIMIT $4" in sql


@pytest.mark.asyncio
async def test_close_is_safe_when_never_connected():
    store = _make_store()
    await store.close()  # no pool created yet — must not raise


@pytest.mark.asyncio
async def test_upsert_batches_records():
    store = _make_store()
    store._get_ext_pool = AsyncMock(return_value=MagicMock())

    executed: list[list] = []
    conn = AsyncMock()

    async def _executemany(sql, rows):
        executed.append(rows)

    conn.executemany = _executemany
    tx = AsyncMock()
    tx.__aenter__ = AsyncMock(return_value=None)
    tx.__aexit__ = AsyncMock(return_value=False)
    conn.transaction = MagicMock(return_value=tx)

    with patch(f"{_MODULE}.acquire_with_retry", return_value=_ctx(conn)):
        await store.upsert(
            [
                VectorRecord(chunk_id=1, org_slug="orga", document_id=uuid.uuid4(), embedding=[1.0]),
                VectorRecord(chunk_id=2, org_slug="orga", document_id=uuid.uuid4(), embedding=[0.0]),
            ]
        )

    assert len(executed) == 1
    assert len(executed[0]) == 2
    # Row tuple shape: (chunk_id, org_slug, document_id, embedding-as-json).
    assert executed[0][0][0] == 1
    assert executed[0][0][3] == json.dumps([1.0])

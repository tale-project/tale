"""Cross-org isolation tests for RagService.

The data layer is now per-tenant: `documents` and `chunks` both carry an
`org_slug` column (NOT NULL DEFAULT 'default'), every SELECT/UPDATE/DELETE
filters by it, and chunks.org_slug is FK-tied to documents.org_slug.

These tests pin the invariant down at the application layer by verifying
that the SQL the service issues actually carries `org_slug` and that the
methods route caller-supplied slugs into the parameter list.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytestmark = pytest.mark.asyncio

ORG_A = "org-a"
ORG_B = "org-b"


def _async_ctx(mock_conn):
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return ctx


def _mock_conn(*, fetch_return=None, fetchrow_return=None):
    conn = AsyncMock()
    conn.fetch = AsyncMock(return_value=fetch_return or [])
    conn.fetchrow = AsyncMock(return_value=fetchrow_return)
    conn.execute = AsyncMock()

    tx = AsyncMock()
    tx.__aenter__ = AsyncMock(return_value=tx)
    tx.__aexit__ = AsyncMock(return_value=False)
    conn.transaction = MagicMock(return_value=tx)
    return conn


def _make_service():
    """Build a RagService with mocked pool — bypass initialize()."""
    from app.services.rag_service import RagService

    service = RagService()
    service.initialized = True
    service._pool = MagicMock()
    return service


class TestSearchScopeClause:
    """`_build_scope_clause` always emits the org filter."""

    def test_empty_file_ids_still_scopes_by_org(self):
        from app.services.search_service import RagSearchService

        svc = RagSearchService(MagicMock(), MagicMock())
        clause, params = svc._build_scope_clause(ORG_A, [], 1)
        # P0-1 fix: empty file_ids no longer drops the WHERE clause.
        assert "org_slug" in clause
        assert params == [ORG_A]

    def test_none_file_ids_still_scopes_by_org(self):
        from app.services.search_service import RagSearchService

        svc = RagSearchService(MagicMock(), MagicMock())
        clause, params = svc._build_scope_clause(ORG_B, None, 1)
        assert "org_slug" in clause
        assert "file_id" not in clause
        assert params == [ORG_B]

    def test_non_empty_file_ids_adds_doc_filter_within_org(self):
        from app.services.search_service import RagSearchService

        svc = RagSearchService(MagicMock(), MagicMock())
        clause, params = svc._build_scope_clause(ORG_A, ["d1", "d2"], 1)
        # Inner documents subquery also scoped by org_slug — defense in depth.
        assert clause.count("org_slug") == 2
        assert "file_id = ANY" in clause
        assert params == [ORG_A, ["d1", "d2"]]

    def test_folder_path_filter_is_org_scoped(self):
        from app.services.search_service import RagSearchService

        svc = RagSearchService(MagicMock(), MagicMock())
        clause, params = svc._build_scope_clause(ORG_A, None, 1, folder_path="shared-folder")
        # The folder filter rides the same org-scoped documents subquery —
        # an identical folder name in another org can never match.
        assert clause.count("org_slug") == 2
        assert "folder_path" in clause
        assert params == [ORG_A, "shared-folder"]


class TestDeleteDocumentScopedByOrg:
    """`delete_document` only deletes within `org_slug`."""

    async def test_delete_passes_org_slug_to_select(self):
        service = _make_service()
        mock_conn = _mock_conn(fetch_return=[])  # nothing matches → no-op
        with patch(
            "app.services.rag_service.acquire_with_retry",
            return_value=_async_ctx(mock_conn),
        ):
            await service.delete_document(ORG_A, "doc-1")

        # SELECT query must carry org_slug AND file_id.
        sql, *params = mock_conn.fetch.call_args[0]
        assert "org_slug = $1" in sql
        assert "file_id = $2" in sql
        assert params == [ORG_A, "doc-1"]

    async def test_delete_no_match_returns_zero(self):
        """Foreign-org file_id returns 0 deletions, not the other org's data."""
        service = _make_service()
        mock_conn = _mock_conn(fetch_return=[])

        with patch(
            "app.services.rag_service.acquire_with_retry",
            return_value=_async_ctx(mock_conn),
        ):
            result = await service.delete_document(ORG_B, "doc-owned-by-org-a")

        assert result["success"] is True
        assert result["deleted_count"] == 0
        # No transaction opened when nothing to delete.
        mock_conn.transaction.assert_not_called()

    async def test_delete_match_scopes_chunks_and_documents_to_org(self):
        service = _make_service()
        mock_conn = _mock_conn(fetch_return=[{"id": "uuid-1"}])

        with patch(
            "app.services.rag_service.acquire_with_retry",
            return_value=_async_ctx(mock_conn),
        ):
            await service.delete_document(ORG_A, "doc-1")

        # Both DELETEs must be scoped by org_slug. asyncpg.execute signature:
        # execute(sql, *args). We assert both calls.
        execute_calls = mock_conn.execute.call_args_list
        assert len(execute_calls) == 2  # chunks then documents

        chunks_sql, *chunks_params = execute_calls[0][0]
        assert "chunks" in chunks_sql
        assert "org_slug = $1" in chunks_sql
        assert chunks_params[0] == ORG_A

        docs_sql, *docs_params = execute_calls[1][0]
        assert "documents" in docs_sql
        assert "org_slug = $1" in docs_sql
        assert docs_params[0] == ORG_A


class TestGetDocumentContentScopedByOrg:
    """`get_document_content` returns None for foreign-org documents."""

    async def test_foreign_org_returns_none(self):
        service = _make_service()
        # fetchrow returns None — simulates the SQL not matching because
        # org_slug $1 filters out the foreign-org row.
        mock_conn = _mock_conn(fetchrow_return=None)

        with patch(
            "app.services.rag_service.acquire_with_retry",
            return_value=_async_ctx(mock_conn),
        ):
            result = await service.get_document_content(ORG_B, "doc-owned-by-org-a")

        assert result is None
        sql, *params = mock_conn.fetchrow.call_args[0]
        assert "org_slug = $1" in sql
        assert params[0] == ORG_B


class TestGetDocumentStatusesScopedByOrg:
    """`get_document_statuses` filters by org."""

    async def test_org_filter_threaded_into_sql(self):
        service = _make_service()
        mock_conn = _mock_conn(fetch_return=[])

        with patch(
            "app.services.rag_service.acquire_with_retry",
            return_value=_async_ctx(mock_conn),
        ):
            result = await service.get_document_statuses(ORG_A, ["f1", "f2"])

        # All requested ids resolve to None (foreign-org or unknown).
        assert result == {"f1": None, "f2": None}
        sql, *params = mock_conn.fetch.call_args[0]
        assert "org_slug = $1" in sql
        assert params[0] == ORG_A
        assert params[1] == ["f1", "f2"]


class TestCrossOrgDedupDisabled:
    """`find_existing_by_hash` is org-scoped — no cross-org content probing."""

    async def test_same_hash_in_different_org_not_returned(self):
        from app.services.indexing_service import find_existing_by_hash

        # Mock returning None even when the hash matches — the caller's
        # org_slug filter is what produces the None.
        pool = MagicMock()
        mock_conn = _mock_conn(fetchrow_return=None)

        with patch(
            "app.services.indexing_service.acquire_with_retry",
            return_value=_async_ctx(mock_conn),
        ):
            result = await find_existing_by_hash(pool, ORG_B, "shared-hash")

        assert result is None
        sql, *params = mock_conn.fetchrow.call_args[0]
        assert "org_slug = $1" in sql
        assert params == [ORG_B, "shared-hash"]

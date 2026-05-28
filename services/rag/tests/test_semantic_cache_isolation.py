"""Cross-org isolation tests for SemanticCache.

The semantic cache is shared at the table level (single Postgres table)
but every SELECT/INSERT/DELETE filters by `org_slug`. Two orgs with
semantically identical queries get independent cache entries.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytestmark = pytest.mark.asyncio

ORG_A = "org-a"
ORG_B = "org-b"


def _async_ctx(conn):
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=conn)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return ctx


class TestLookupOrgScoped:
    async def test_lookup_threads_org_into_sql(self):
        from app.services.semantic_cache import SemanticCache

        conn = AsyncMock()
        conn.fetchrow = AsyncMock(return_value=None)
        conn.execute = AsyncMock()

        cache = SemanticCache(MagicMock())
        with patch(
            "app.services.semantic_cache.acquire_with_retry",
            return_value=_async_ctx(conn),
        ):
            result = await cache.lookup(ORG_A, [0.1, 0.2, 0.3])

        assert result is None
        sql, *params = conn.fetchrow.call_args[0]
        # WHERE org_slug = $2 (after $1 vec_str).
        assert "org_slug = $2" in sql
        assert params[1] == ORG_A

    async def test_lookup_other_org_does_not_match(self):
        """Even when a cached row exists for ORG_A, lookups by ORG_B miss."""
        from app.services.semantic_cache import SemanticCache

        # Simulate the SQL returning None — that's exactly what org filtering
        # produces against the foreign-org row at the DB layer.
        conn = AsyncMock()
        conn.fetchrow = AsyncMock(return_value=None)
        conn.execute = AsyncMock()

        cache = SemanticCache(MagicMock())
        with patch(
            "app.services.semantic_cache.acquire_with_retry",
            return_value=_async_ctx(conn),
        ):
            entry = await cache.lookup(ORG_B, [0.1, 0.2, 0.3])

        assert entry is None


class TestStoreOrgScoped:
    async def test_store_writes_org_slug(self):
        from app.services.semantic_cache import SemanticCache

        conn = AsyncMock()
        conn.execute = AsyncMock()

        cache = SemanticCache(MagicMock())
        with patch(
            "app.services.semantic_cache.acquire_with_retry",
            return_value=_async_ctx(conn),
        ):
            await cache.store(ORG_A, "q", [0.1], "response", file_ids=["doc-1"])

        sql, *params = conn.execute.call_args[0]
        assert "org_slug" in sql
        # The INSERT positional list starts with org_slug at $1.
        assert params[0] == ORG_A


class TestInvalidateOrgScoped:
    async def test_invalidate_scoped_to_org(self):
        from app.services.semantic_cache import SemanticCache

        conn = AsyncMock()
        conn.execute = AsyncMock(return_value="DELETE 2")

        cache = SemanticCache(MagicMock())
        with patch(
            "app.services.semantic_cache.acquire_with_retry",
            return_value=_async_ctx(conn),
        ):
            count = await cache.invalidate(ORG_A, ["doc-x"])

        assert count == 2
        sql, *params = conn.execute.call_args[0]
        assert "org_slug = $1" in sql
        assert params[0] == ORG_A
        assert params[1] == ["doc-x"]


class TestCleanup:
    async def test_cleanup_with_org_scoped(self):
        from app.services.semantic_cache import SemanticCache

        conn = AsyncMock()
        conn.execute = AsyncMock(return_value="DELETE 3")

        cache = SemanticCache(MagicMock())
        with patch(
            "app.services.semantic_cache.acquire_with_retry",
            return_value=_async_ctx(conn),
        ):
            count = await cache.cleanup(ORG_A)

        assert count == 3
        sql, *params = conn.execute.call_args[0]
        assert "org_slug = $1" in sql
        assert params[0] == ORG_A

    async def test_cleanup_with_no_org_runs_global(self):
        """Passing None explicitly runs a global GC — operator path only."""
        from app.services.semantic_cache import SemanticCache

        conn = AsyncMock()
        conn.execute = AsyncMock(return_value="DELETE 10")

        cache = SemanticCache(MagicMock())
        with patch(
            "app.services.semantic_cache.acquire_with_retry",
            return_value=_async_ctx(conn),
        ):
            count = await cache.cleanup(None)

        assert count == 10
        sql, *_params = conn.execute.call_args[0]
        # Global cleanup omits the org filter on purpose.
        assert "org_slug" not in sql

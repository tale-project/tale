"""Tests for the per-org website_org_memberships layer.

Covers `PgWebsiteStoreManager.register_website` / `begin_delete` /
`get_due_websites` / `org_has_membership` against an in-memory
asyncpg pool stand-in. The aim is to lock in the ref-counted delete
semantics — websites/chunks rows are deployment-shared, but the
"who can see this domain" decision is org-local.
"""

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.pg_website_store import PgWebsiteStoreManager

pytestmark = pytest.mark.asyncio


def _make_conn(*, fetchval_return=0, execute_return="DELETE 1", fetchrow_return=None):
    """Build a per-test asyncpg connection stub with configurable returns.

    `fetchrow_return` may be a single value (returned for every fetchrow
    call) or a list (each call pops the next entry). `register_website`
    now does two fetchrows — the websites UPSERT (returns scan_interval +
    status) and the membership insert (returns the `inserted` flag).
    """
    conn = AsyncMock()
    conn.execute = AsyncMock(return_value=execute_return)
    conn.fetchval = AsyncMock(return_value=fetchval_return)
    if isinstance(fetchrow_return, list):
        conn.fetchrow = AsyncMock(side_effect=list(fetchrow_return))
    else:
        conn.fetchrow = AsyncMock(return_value=fetchrow_return)
    # Transactions are no-ops at this layer; just yield the same conn.
    conn.transaction = MagicMock()
    conn.transaction.return_value.__aenter__ = AsyncMock(return_value=None)
    conn.transaction.return_value.__aexit__ = AsyncMock(return_value=None)
    return conn


def _patch_acquire(conn):
    """Patch `acquire_with_retry` to yield our stub connection."""

    @asynccontextmanager
    async def _acq(_pool, **_kw):
        yield conn

    return patch("app.services.pg_website_store.acquire_with_retry", _acq)


class TestRegisterWebsite:
    async def test_first_membership_reports_first_membership_true(self):
        conn = _make_conn(
            fetchval_return=1,  # total members after insert = 1
            fetchrow_return=[
                {"scan_interval": 3600, "status": "idle"},  # websites UPSERT RETURNING
                {"inserted": True},  # membership INSERT RETURNING
            ],
        )
        with _patch_acquire(conn):
            manager = PgWebsiteStoreManager(pool=MagicMock())
            result = await manager.register_website(domain="example.com", scan_interval=3600, org_slug="acme")

        assert result["first_membership"] is True
        assert result["domain"] == "example.com"
        assert result["scan_interval"] == 3600

    async def test_second_org_joining_does_not_report_first_membership(self):
        conn = _make_conn(
            fetchval_return=2,  # total members after insert = 2
            fetchrow_return=[
                {"scan_interval": 3600, "status": "idle"},
                {"inserted": True},
            ],
        )
        with _patch_acquire(conn):
            manager = PgWebsiteStoreManager(pool=MagicMock())
            result = await manager.register_website(domain="example.com", scan_interval=3600, org_slug="beta")

        assert result["first_membership"] is False

    async def test_idempotent_when_same_org_re_registers(self):
        # ON CONFLICT DO NOTHING on the membership insert → no RETURNING row.
        # The websites UPSERT still returns its stored row, so feed both.
        conn = _make_conn(
            fetchval_return=1,
            fetchrow_return=[
                {"scan_interval": 3600, "status": "idle"},
                None,
            ],
        )
        with _patch_acquire(conn):
            manager = PgWebsiteStoreManager(pool=MagicMock())
            result = await manager.register_website(domain="example.com", scan_interval=3600, org_slug="acme")

        assert result["first_membership"] is False


class TestBeginDelete:
    async def test_removes_website_when_last_membership(self):
        conn = _make_conn(
            fetchval_return=0,  # no memberships left after delete
            execute_return="DELETE 1",  # the membership row was deleted
            fetchrow_return={"domain": "example.com"},  # website marked deleting
        )
        with _patch_acquire(conn):
            manager = PgWebsiteStoreManager(pool=MagicMock())
            result = await manager.begin_delete("example.com", "acme")

        assert result == {"removed_membership": True, "removed_website": True}

    async def test_keeps_website_when_other_orgs_remain(self):
        conn = _make_conn(
            fetchval_return=2,  # 2 other orgs still tracking
            execute_return="DELETE 1",
            fetchrow_return=None,
        )
        with _patch_acquire(conn):
            manager = PgWebsiteStoreManager(pool=MagicMock())
            result = await manager.begin_delete("example.com", "acme")

        assert result == {"removed_membership": True, "removed_website": False}

    async def test_no_membership_returns_false_false(self):
        """Caller's org never tracked this domain — neither rm-membership nor rm-website fires."""
        conn = _make_conn(
            fetchval_return=3,
            execute_return="DELETE 0",  # no row matched the (domain, org) tuple
            fetchrow_return=None,
        )
        with _patch_acquire(conn):
            manager = PgWebsiteStoreManager(pool=MagicMock())
            result = await manager.begin_delete("example.com", "ghost")

        assert result == {"removed_membership": False, "removed_website": False}


class TestOrgHasMembership:
    async def test_returns_true_when_row_exists(self):
        conn = _make_conn(fetchrow_return={"?column?": 1})
        with _patch_acquire(conn):
            manager = PgWebsiteStoreManager(pool=MagicMock())
            assert await manager.org_has_membership("example.com", "acme") is True

    async def test_returns_false_when_row_missing(self):
        conn = _make_conn(fetchrow_return=None)
        with _patch_acquire(conn):
            manager = PgWebsiteStoreManager(pool=MagicMock())
            assert await manager.org_has_membership("example.com", "ghost") is False


class TestGetDueWebsites:
    async def test_includes_owner_org_slug(self):
        conn = _make_conn()
        # fetch() returns rows; the test cares about shape, not SQL.
        conn.fetch = AsyncMock(
            return_value=[
                {
                    "domain": "example.com",
                    "status": "idle",
                    "scan_interval": 3600,
                    "last_scanned_at": None,
                    "error": None,
                    "owner_org_slug": "acme",
                }
            ]
        )
        with _patch_acquire(conn):
            manager = PgWebsiteStoreManager(pool=MagicMock())
            due = await manager.get_due_websites()

        assert len(due) == 1
        assert due[0]["domain"] == "example.com"
        assert due[0]["owner_org_slug"] == "acme"

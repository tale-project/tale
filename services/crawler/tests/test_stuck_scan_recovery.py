"""Tests for stuck scan recovery via get_due_websites()."""

from unittest.mock import AsyncMock, MagicMock

import pytest
import stamina

from app.services.pg_website_store import PgWebsiteStoreManager

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def _fast_stamina_retries():
    """Keep retries but disable backoff delays for speed."""
    with stamina.set_testing(True, attempts=1):
        yield


@pytest.fixture
def mock_conn():
    conn = AsyncMock()
    conn.fetchval = AsyncMock(return_value=0)
    conn.fetch = AsyncMock(return_value=[])
    conn.fetchrow = AsyncMock(return_value=None)
    conn.execute = AsyncMock()
    conn.executemany = AsyncMock()
    conn.transaction = MagicMock(return_value=AsyncMock(__aenter__=AsyncMock(), __aexit__=AsyncMock()))
    return conn


@pytest.fixture
def mock_pool(mock_conn):
    pool = AsyncMock()
    pool.acquire = AsyncMock(return_value=mock_conn)
    pool.release = AsyncMock()
    return pool


@pytest.fixture
def manager(mock_pool):
    return PgWebsiteStoreManager(mock_pool)


class TestGetDueWebsitesStuckRecovery:
    """Test that get_due_websites() includes stuck-scanning websites."""

    async def test_returns_stuck_scanning_website(self, manager, mock_conn):
        mock_conn.fetch = AsyncMock(
            return_value=[
                {
                    "domain": "stuck.com",
                    "status": "scanning",
                    "scan_interval": 21600,
                    "last_scanned_at": None,
                    "error": None,
                },
            ]
        )

        result = await manager.get_due_websites()

        assert len(result) == 1
        assert result[0]["domain"] == "stuck.com"
        assert result[0]["status"] == "scanning"

    async def test_returns_normally_due_websites(self, manager, mock_conn):
        mock_conn.fetch = AsyncMock(
            return_value=[
                {
                    "domain": "due.com",
                    "status": "active",
                    "scan_interval": 21600,
                    "last_scanned_at": None,
                    "error": None,
                },
            ]
        )

        result = await manager.get_due_websites()

        assert len(result) == 1
        assert result[0]["domain"] == "due.com"

    async def test_returns_mix_of_due_and_stuck(self, manager, mock_conn):
        mock_conn.fetch = AsyncMock(
            return_value=[
                {
                    "domain": "due.com",
                    "status": "active",
                    "scan_interval": 21600,
                    "last_scanned_at": None,
                    "error": None,
                },
                {
                    "domain": "stuck.com",
                    "status": "scanning",
                    "scan_interval": 21600,
                    "last_scanned_at": None,
                    "error": None,
                },
            ]
        )

        result = await manager.get_due_websites()

        domains = {r["domain"] for r in result}
        assert domains == {"due.com", "stuck.com"}

    async def test_returns_empty_when_nothing_due(self, manager, mock_conn):
        mock_conn.fetch = AsyncMock(return_value=[])

        result = await manager.get_due_websites()

        assert result == []

    async def test_query_includes_2_hour_threshold(self, manager, mock_conn):
        mock_conn.fetch = AsyncMock(return_value=[])

        await manager.get_due_websites()

        sql = str(mock_conn.fetch.call_args)
        assert "2 hours" in sql

    async def test_query_includes_scanning_recovery(self, manager, mock_conn):
        mock_conn.fetch = AsyncMock(return_value=[])

        await manager.get_due_websites()

        sql = str(mock_conn.fetch.call_args)
        assert "scanning" in sql
        assert "updated_at" in sql

    async def test_query_excludes_deleting_status(self, manager, mock_conn):
        mock_conn.fetch = AsyncMock(return_value=[])

        await manager.get_due_websites()

        sql = str(mock_conn.fetch.call_args)
        assert "deleting" in sql

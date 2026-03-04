"""Tests for recover_stuck_scans: resetting websites stuck in 'scanning' status."""

from contextlib import asynccontextmanager
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


class TestRecoverStuckScans:
    async def test_returns_stuck_scanning_domains(self, manager, mock_conn):
        mock_conn.fetch = AsyncMock(return_value=[{"domain": "stuck.com"}])

        result = await manager.recover_stuck_scans()

        assert result == ["stuck.com"]

    async def test_returns_empty_list_when_no_stuck_websites(self, manager, mock_conn):
        mock_conn.fetch = AsyncMock(return_value=[])

        result = await manager.recover_stuck_scans()

        assert result == []

    async def test_returns_multiple_stuck_domains(self, manager, mock_conn):
        mock_conn.fetch = AsyncMock(
            return_value=[
                {"domain": "stuck1.com"},
                {"domain": "stuck2.com"},
                {"domain": "stuck3.com"},
            ]
        )

        result = await manager.recover_stuck_scans()

        assert result == ["stuck1.com", "stuck2.com", "stuck3.com"]

    async def test_query_filters_by_scanning_status(self, manager, mock_conn):
        mock_conn.fetch = AsyncMock(return_value=[])

        await manager.recover_stuck_scans()

        sql = str(mock_conn.fetch.call_args)
        assert "scanning" in sql

    async def test_query_includes_time_threshold(self, manager, mock_conn):
        mock_conn.fetch = AsyncMock(return_value=[])

        await manager.recover_stuck_scans()

        sql = str(mock_conn.fetch.call_args)
        assert "30 minutes" in sql

    async def test_idempotent_second_call_returns_empty(self, manager, mock_conn):
        mock_conn.fetch = AsyncMock(
            side_effect=[
                [{"domain": "stuck.com"}],
                [],
            ]
        )

        first = await manager.recover_stuck_scans()
        second = await manager.recover_stuck_scans()

        assert first == ["stuck.com"]
        assert second == []


class TestRecoveryStartupFlow:
    """Test the startup recovery flow: recover_stuck_scans → update_scan_status."""

    async def test_recovered_domain_reset_to_idle(self, manager, mock_conn):
        mock_conn.fetch = AsyncMock(return_value=[{"domain": "stuck.com"}])

        stuck = await manager.recover_stuck_scans()
        for domain in stuck:
            await manager.update_scan_status(domain, "idle")

        execute_calls = [str(c) for c in mock_conn.execute.call_args_list]
        assert any("idle" in c and "stuck.com" in c for c in execute_calls)

    async def test_error_field_is_none_after_recovery(self, manager, mock_conn):
        mock_conn.fetch = AsyncMock(return_value=[{"domain": "stuck.com"}])

        stuck = await manager.recover_stuck_scans()
        for domain in stuck:
            await manager.update_scan_status(domain, "idle")

        call_args = mock_conn.execute.call_args
        assert call_args[0][3] is None

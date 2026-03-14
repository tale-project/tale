"""Tests for asyncpg connection retry logic."""

from unittest.mock import AsyncMock, MagicMock, patch

import asyncpg
import pytest

from tale_shared.db.retry import acquire_with_retry, transact_with_retry


class TestAcquireWithRetry:
    @pytest.mark.asyncio
    async def test_successful_acquire(self):
        mock_conn = AsyncMock()
        mock_pool = MagicMock(spec=asyncpg.Pool)
        mock_pool.acquire = AsyncMock(return_value=mock_conn)
        mock_pool.release = AsyncMock()

        async with acquire_with_retry(mock_pool) as conn:
            assert conn is mock_conn

        mock_pool.acquire.assert_awaited_once()
        mock_pool.release.assert_awaited_once_with(mock_conn)

    @pytest.mark.asyncio
    async def test_releases_on_exception(self):
        mock_conn = AsyncMock()
        mock_pool = MagicMock(spec=asyncpg.Pool)
        mock_pool.acquire = AsyncMock(return_value=mock_conn)
        mock_pool.release = AsyncMock()

        with pytest.raises(RuntimeError, match="test error"):
            async with acquire_with_retry(mock_pool) as conn:
                raise RuntimeError("test error")

        mock_pool.release.assert_awaited_once_with(mock_conn)

    @pytest.mark.asyncio
    async def test_retries_on_transient_error(self):
        mock_conn = AsyncMock()
        mock_pool = MagicMock(spec=asyncpg.Pool)
        mock_pool.acquire = AsyncMock(
            side_effect=[OSError("connection refused"), mock_conn]
        )
        mock_pool.release = AsyncMock()

        async with acquire_with_retry(mock_pool, attempts=3, timeout=10) as conn:
            assert conn is mock_conn

        assert mock_pool.acquire.await_count == 2
        mock_pool.release.assert_awaited_once_with(mock_conn)


def _make_pool_with_transaction(conn: AsyncMock) -> MagicMock:
    """Create a mock pool whose acquire() context yields *conn* with a working transaction()."""
    pool = MagicMock(spec=asyncpg.Pool)

    # pool.acquire() returns an async context manager yielding conn
    acq_ctx = AsyncMock()
    acq_ctx.__aenter__ = AsyncMock(return_value=conn)
    acq_ctx.__aexit__ = AsyncMock(return_value=False)
    pool.acquire = MagicMock(return_value=acq_ctx)

    # conn.transaction() returns an async context manager
    tx_ctx = AsyncMock()
    tx_ctx.__aenter__ = AsyncMock(return_value=None)
    tx_ctx.__aexit__ = AsyncMock(return_value=False)
    conn.transaction = MagicMock(return_value=tx_ctx)

    return pool


class TestTransactWithRetry:
    @pytest.mark.asyncio
    async def test_successful_callback(self):
        conn = AsyncMock()
        pool = _make_pool_with_transaction(conn)

        callback = AsyncMock(return_value=42)
        result = await transact_with_retry(pool, callback, attempts=3, timeout=10)

        assert result == 42
        callback.assert_awaited_once_with(conn)

    @pytest.mark.asyncio
    async def test_retries_on_connection_does_not_exist(self):
        conn = AsyncMock()
        pool = _make_pool_with_transaction(conn)

        callback = AsyncMock(
            side_effect=[
                asyncpg.ConnectionDoesNotExistError("connection was closed"),
                "ok",
            ]
        )
        result = await transact_with_retry(pool, callback, attempts=3, timeout=10)

        assert result == "ok"
        assert callback.await_count == 2

    @pytest.mark.asyncio
    async def test_retries_on_interface_error(self):
        conn = AsyncMock()
        pool = _make_pool_with_transaction(conn)

        callback = AsyncMock(
            side_effect=[asyncpg.InterfaceError("connection is closed"), "ok"]
        )
        result = await transact_with_retry(pool, callback, attempts=3, timeout=10)

        assert result == "ok"
        assert callback.await_count == 2

    @pytest.mark.asyncio
    async def test_retries_on_connection_reset(self):
        conn = AsyncMock()
        pool = _make_pool_with_transaction(conn)

        callback = AsyncMock(
            side_effect=[ConnectionResetError("Connection reset by peer"), "ok"]
        )
        result = await transact_with_retry(pool, callback, attempts=3, timeout=10)

        assert result == "ok"
        assert callback.await_count == 2

    @pytest.mark.asyncio
    async def test_does_not_retry_on_non_connection_error(self):
        conn = AsyncMock()
        pool = _make_pool_with_transaction(conn)

        callback = AsyncMock(side_effect=asyncpg.UniqueViolationError("duplicate key"))
        with pytest.raises(asyncpg.UniqueViolationError):
            await transact_with_retry(pool, callback, attempts=3, timeout=10)

        callback.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_fresh_connection_per_retry(self):
        """Each retry attempt should call pool.acquire() again."""
        conn = AsyncMock()
        pool = _make_pool_with_transaction(conn)

        callback = AsyncMock(
            side_effect=[asyncpg.ConnectionDoesNotExistError("closed"), "ok"]
        )
        await transact_with_retry(pool, callback, attempts=3, timeout=10)

        assert pool.acquire.call_count == 2

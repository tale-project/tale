"""Tests for asyncpg connection retry logic."""

from unittest.mock import AsyncMock, MagicMock

import asyncpg
import pytest

from tale_shared.db.retry import acquire_with_retry


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

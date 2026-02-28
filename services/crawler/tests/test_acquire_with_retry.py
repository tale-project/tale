"""Tests for acquire_with_retry: connection resilience on transient DB errors."""

from unittest.mock import AsyncMock, MagicMock

import asyncpg
import pytest
import stamina

from app.services.database import acquire_with_retry


@pytest.fixture(autouse=True)
def _fast_stamina_retries():
    """Keep retries but disable backoff delays for speed."""
    with stamina.set_testing(True, attempts=5):
        yield


def _make_pool(acquire_side_effect=None):
    """Build a mock asyncpg pool."""
    conn = AsyncMock()
    pool = MagicMock(spec=asyncpg.Pool)
    pool.acquire = AsyncMock(return_value=conn)
    pool.release = AsyncMock()
    if acquire_side_effect is not None:
        pool.acquire = AsyncMock(side_effect=acquire_side_effect)
    return pool, conn


class TestAcquireWithRetry:
    @pytest.mark.asyncio
    async def test_succeeds_on_first_try(self):
        pool, conn = _make_pool()

        async with acquire_with_retry(pool) as c:
            assert c is conn

        pool.acquire.assert_awaited_once()
        pool.release.assert_awaited_once_with(conn)

    @pytest.mark.asyncio
    async def test_retries_on_cannot_connect_now(self):
        conn = AsyncMock()
        pool, _ = _make_pool(
            acquire_side_effect=[
                asyncpg.CannotConnectNowError(),
                asyncpg.CannotConnectNowError(),
                conn,
            ]
        )

        async with acquire_with_retry(pool) as c:
            assert c is conn

        assert pool.acquire.await_count == 3
        pool.release.assert_awaited_once_with(conn)

    @pytest.mark.asyncio
    async def test_retries_on_os_error(self):
        conn = AsyncMock()
        pool, _ = _make_pool(acquire_side_effect=[ConnectionRefusedError(), conn])

        async with acquire_with_retry(pool) as c:
            assert c is conn

        assert pool.acquire.await_count == 2

    @pytest.mark.asyncio
    async def test_raises_after_exhausted_retries(self):
        pool, _ = _make_pool(acquire_side_effect=asyncpg.CannotConnectNowError())

        with pytest.raises(asyncpg.CannotConnectNowError):
            async with acquire_with_retry(pool):
                pass

    @pytest.mark.asyncio
    async def test_non_transient_error_propagates_immediately(self):
        pool, _ = _make_pool(acquire_side_effect=asyncpg.InvalidCatalogNameError("no such db"))

        with pytest.raises(asyncpg.InvalidCatalogNameError):
            async with acquire_with_retry(pool):
                pass

        pool.acquire.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_releases_connection_on_body_error(self):
        pool, conn = _make_pool()

        with pytest.raises(ValueError, match="boom"):
            async with acquire_with_retry(pool):
                raise ValueError("boom")

        pool.release.assert_awaited_once_with(conn)

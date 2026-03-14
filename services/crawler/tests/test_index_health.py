"""Tests for chunks index health check and repair."""

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import asyncpg
import pytest

from app.services.index_health import (
    _BM25_INDEX,
    _HNSW_INDEX,
    check_and_repair_chunks_index,
    reindex_chunks,
)


def _mock_acquire(conn):
    """Return an acquire_with_retry replacement that yields *conn*."""

    @asynccontextmanager
    async def _acq(_pool, **_kw):
        yield conn

    return _acq


@pytest.fixture
def conn():
    return AsyncMock()


@pytest.fixture
def pool():
    return MagicMock(spec=asyncpg.Pool)


class TestReindexChunks:
    @pytest.mark.asyncio
    async def test_reindexes_both_indexes(self, pool, conn):
        conn.execute = AsyncMock()

        with patch("app.services.index_health.acquire_with_retry", _mock_acquire(conn)):
            await reindex_chunks(pool)

        calls = conn.execute.call_args_list
        reindex_calls = [c for c in calls if "REINDEX" in str(c)]
        assert len(reindex_calls) == 2
        assert any(_BM25_INDEX in str(c) for c in reindex_calls)
        assert any(_HNSW_INDEX in str(c) for c in reindex_calls)

    @pytest.mark.asyncio
    async def test_skips_missing_index(self, pool, conn):
        conn.execute = AsyncMock(side_effect=[asyncpg.UndefinedObjectError("index does not exist"), None])

        with patch("app.services.index_health.acquire_with_retry", _mock_acquire(conn)):
            await reindex_chunks(pool)

        assert conn.execute.await_count == 2

    @pytest.mark.asyncio
    async def test_continues_on_error(self, pool, conn):
        conn.execute = AsyncMock(side_effect=[RuntimeError("disk full"), None])

        with patch("app.services.index_health.acquire_with_retry", _mock_acquire(conn)):
            await reindex_chunks(pool)

        assert conn.execute.await_count == 2


class TestCheckAndRepairChunksIndex:
    @pytest.mark.asyncio
    async def test_healthy_index_no_repair(self, pool, conn):
        conn.execute = AsyncMock()
        conn.fetchval = AsyncMock(return_value=0)

        with (
            patch("app.services.index_health.acquire_with_retry", _mock_acquire(conn)),
            patch("app.services.index_health.reindex_chunks", new_callable=AsyncMock) as mock_reindex,
        ):
            await check_and_repair_chunks_index(pool)

        mock_reindex.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_corrupted_index_triggers_repair(self, pool, conn):
        conn.execute = AsyncMock()
        conn.fetchval = AsyncMock(side_effect=asyncpg.InterfaceError("connection lost"))

        with (
            patch("app.services.index_health.acquire_with_retry", _mock_acquire(conn)),
            patch("app.services.index_health.reindex_chunks", new_callable=AsyncMock) as mock_reindex,
        ):
            await check_and_repair_chunks_index(pool)

        mock_reindex.assert_awaited_once_with(pool)

    @pytest.mark.asyncio
    async def test_connection_error_triggers_repair(self, pool, conn):
        conn.execute = AsyncMock(side_effect=ConnectionResetError("reset"))

        with (
            patch("app.services.index_health.acquire_with_retry", _mock_acquire(conn)),
            patch("app.services.index_health.reindex_chunks", new_callable=AsyncMock) as mock_reindex,
        ):
            await check_and_repair_chunks_index(pool)

        mock_reindex.assert_awaited_once_with(pool)

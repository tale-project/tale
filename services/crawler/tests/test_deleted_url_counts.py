"""Tests for deleted URL exclusion from page counts and resurrection on re-discovery."""

from unittest.mock import AsyncMock, MagicMock

import pytest
import stamina

from app.services.pg_website_store import PgWebsiteStore, PgWebsiteStoreManager

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def _fast_stamina_retries():
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
def site_store(mock_pool):
    return PgWebsiteStore(mock_pool, "example.com")


@pytest.fixture
def manager(mock_pool):
    return PgWebsiteStoreManager(mock_pool)


class TestGetWebsiteExcludesDeleted:
    async def test_lateral_join_excludes_deleted_from_total(self, manager, mock_conn):
        await manager.get_website("example.com")

        sql = mock_conn.fetchrow.call_args[0][0]
        assert "status != 'deleted'" in sql

    async def test_lateral_join_excludes_deleted_from_crawled(self, manager, mock_conn):
        await manager.get_website("example.com")

        sql = mock_conn.fetchrow.call_args[0][0]
        assert "content_hash IS NOT NULL AND status != 'deleted'" in sql


class TestGetTotalCountExcludesDeleted:
    async def test_excludes_deleted_without_status_filter(self, site_store, mock_conn):
        await site_store.get_total_count()

        sql = mock_conn.fetchval.call_args[0][0]
        assert "status != 'deleted'" in sql

    async def test_with_status_filter_unchanged(self, site_store, mock_conn):
        await site_store.get_total_count(status="active")

        sql = mock_conn.fetchval.call_args[0][0]
        assert "status = $2" in sql


class TestSaveDiscoveredUrlsResurrection:
    async def test_upsert_resurrects_deleted_urls(self, site_store, mock_conn):
        mock_conn.fetchval = AsyncMock(side_effect=[5, 6])

        await site_store.save_discovered_urls([{"url": "https://example.com/page"}])

        sql = mock_conn.executemany.call_args[0][0]
        assert "ON CONFLICT" in sql
        assert "DO UPDATE" in sql
        assert "status = 'discovered'" in sql
        assert "fail_count = 0" in sql
        assert "website_urls.status = 'deleted'" in sql

    async def test_upsert_only_affects_deleted_urls(self, site_store, mock_conn):
        """The WHERE clause ensures active/discovered URLs are not modified."""
        mock_conn.fetchval = AsyncMock(side_effect=[5, 5])

        await site_store.save_discovered_urls([{"url": "https://example.com/existing"}])

        sql = mock_conn.executemany.call_args[0][0]
        assert "WHERE website_urls.status = 'deleted'" in sql

    async def test_empty_urls_returns_zero(self, site_store):
        result = await site_store.save_discovered_urls([])
        assert result == 0


class TestMarkUrlsDeleted:
    async def test_mark_urls_deleted_cleans_chunks_and_hashes(self, site_store, mock_conn):
        await site_store.mark_urls_deleted(["https://example.com/gone"])

        calls = [str(c) for c in mock_conn.executemany.call_args_list]
        sqls = [mock_conn.executemany.call_args_list[i][0][0] for i in range(len(calls))]

        assert any("DELETE FROM chunks" in sql for sql in sqls)
        assert any("DELETE FROM page_paragraph_hashes" in sql for sql in sqls)
        assert any("status = 'deleted'" in sql for sql in sqls)

    async def test_mark_urls_deleted_deletes_chunks_before_status_update(self, site_store, mock_conn):
        """Chunks and hashes are deleted before the status update."""
        await site_store.mark_urls_deleted(["https://example.com/gone"])

        sqls = [mock_conn.executemany.call_args_list[i][0][0] for i in range(3)]
        assert "DELETE FROM chunks" in sqls[0]
        assert "DELETE FROM page_paragraph_hashes" in sqls[1]
        assert "status = 'deleted'" in sqls[2]

    async def test_mark_urls_deleted_empty_list_noop(self, site_store, mock_conn):
        await site_store.mark_urls_deleted([])

        mock_conn.executemany.assert_not_called()

    async def test_mark_urls_deleted_idempotent(self, site_store, mock_conn):
        """Marking the same URL twice should not error."""
        await site_store.mark_urls_deleted(["https://example.com/gone"])
        await site_store.mark_urls_deleted(["https://example.com/gone"])

        assert mock_conn.executemany.call_count == 6  # 3 calls per deletion

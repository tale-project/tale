"""Tests for deleted URL exclusion from page counts and soft deletion of gone URLs."""

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


class TestSaveDiscoveredUrls:
    async def test_upsert_uses_on_conflict_do_nothing(self, site_store, mock_conn):
        mock_conn.fetchval = AsyncMock(side_effect=[5, 6])

        await site_store.save_discovered_urls([{"url": "https://example.com/page"}])

        sql = mock_conn.executemany.call_args[0][0]
        assert "ON CONFLICT" in sql
        assert "DO NOTHING" in sql

    async def test_skips_already_known_urls(self, site_store, mock_conn):
        """DO NOTHING means deleted URLs stay deleted — no re-discovery loop."""
        mock_conn.fetchval = AsyncMock(side_effect=[10, 10])

        result = await site_store.save_discovered_urls([{"url": "https://example.com/known"}])

        assert result == 0

    async def test_empty_urls_returns_zero(self, site_store):
        result = await site_store.save_discovered_urls([])
        assert result == 0


class TestGetUrlsNeedingRecrawlFailCountLimit:
    async def test_default_max_fail_count_filters_query(self, site_store, mock_conn):
        await site_store.get_urls_needing_recrawl()

        sql = mock_conn.fetch.call_args[0][0]
        assert "fail_count < $2" in sql

    async def test_custom_max_fail_count_passed_to_query(self, site_store, mock_conn):
        await site_store.get_urls_needing_recrawl(max_fail_count=5)

        args = mock_conn.fetch.call_args[0]
        # args[0] = SQL, args[1] = domain, args[2] = max_fail_count
        assert args[2] == 5

    async def test_with_crawled_before_includes_fail_count_filter(self, site_store, mock_conn):
        await site_store.get_urls_needing_recrawl(crawled_before=1000000.0)

        sql = mock_conn.fetch.call_args[0][0]
        assert "fail_count < $2" in sql


class TestMarkUrlsDeleted:
    async def test_deletes_chunks_and_hashes_then_soft_deletes(self, site_store, mock_conn):
        await site_store.mark_urls_deleted(["https://example.com/gone"])

        sqls = [mock_conn.execute.call_args_list[i][0][0] for i in range(3)]
        assert "DELETE FROM chunks" in sqls[0]
        assert "DELETE FROM page_paragraph_hashes" in sqls[1]
        assert "status = 'deleted'" in sqls[2]

    async def test_clears_all_content_fields(self, site_store, mock_conn):
        await site_store.mark_urls_deleted(["https://example.com/gone"])

        update_sql = mock_conn.execute.call_args_list[2][0][0]
        for field in [
            "content_hash = NULL",
            "content = NULL",
            "title = NULL",
            "word_count = NULL",
            "metadata = NULL",
            "structured_data = NULL",
            "etag = NULL",
            "last_modified = NULL",
        ]:
            assert field in update_sql

    async def test_uses_transaction(self, site_store, mock_conn):
        await site_store.mark_urls_deleted(["https://example.com/gone"])

        mock_conn.transaction.assert_called_once()

    async def test_uses_any_for_bulk_params(self, site_store, mock_conn):
        urls = ["https://example.com/a", "https://example.com/b"]
        await site_store.mark_urls_deleted(urls)

        for call in mock_conn.execute.call_args_list:
            assert "ANY($2)" in call[0][0]
            assert call[0][2] == urls

    async def test_empty_list_noop(self, site_store, mock_conn):
        await site_store.mark_urls_deleted([])

        mock_conn.execute.assert_not_called()

    async def test_idempotent(self, site_store, mock_conn):
        """Deleting the same URL twice should not error."""
        await site_store.mark_urls_deleted(["https://example.com/gone"])
        await site_store.mark_urls_deleted(["https://example.com/gone"])

        assert mock_conn.execute.call_count == 6  # 3 calls per deletion

"""Tests for scheduler HTTP error classification: 404/410 → deleted, others → fail_count."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import stamina

from app.services.scheduler import _PERMANENT_HTTP_ERRORS, _scan_website

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
    from app.services.pg_website_store import PgWebsiteStore

    return PgWebsiteStore(mock_pool, "example.com")


@pytest.fixture
def store_manager(mock_pool):
    from app.services.pg_website_store import PgWebsiteStoreManager

    return PgWebsiteStoreManager(mock_pool)


def _crawl_result(url, status_code, content=None):
    """Build a fake crawl result dict matching crawler_service.crawl_urls output."""
    return {"url": url, "status_code": status_code, "content": content}


class TestPermanentHttpErrors:
    def test_constant_includes_404_and_410(self):
        assert 404 in _PERMANENT_HTTP_ERRORS
        assert 410 in _PERMANENT_HTTP_ERRORS

    def test_constant_excludes_transient_errors(self):
        assert 500 not in _PERMANENT_HTTP_ERRORS
        assert 502 not in _PERMANENT_HTTP_ERRORS
        assert 403 not in _PERMANENT_HTTP_ERRORS
        assert 503 not in _PERMANENT_HTTP_ERRORS


class TestSchedulerErrorClassification:
    """Test that _scan_website correctly classifies HTTP errors."""

    async def _run_scan(self, store_manager, mock_conn, crawl_results, urls_to_crawl):
        """Helper: run _scan_website with mocked dependencies."""
        crawler_service = AsyncMock()
        crawler_service.initialized = True
        crawler_service.discover_urls = AsyncMock(return_value=[])
        crawler_service.crawl_urls = AsyncMock(return_value=crawl_results)

        # Mock site_store methods
        mock_conn.fetch = AsyncMock(return_value=[])
        mock_conn.fetchval = AsyncMock(return_value=0)

        site_store = store_manager.get_site_store("example.com")
        site_store.save_discovered_urls = AsyncMock(return_value=0)
        site_store.get_urls_needing_recrawl = AsyncMock(return_value=urls_to_crawl)
        site_store.get_cache_headers = AsyncMock(return_value={})
        site_store.update_content_hashes = AsyncMock()
        site_store.mark_urls_deleted = AsyncMock()
        site_store.increment_fail_count = AsyncMock()
        site_store.touch_crawled_at = AsyncMock()
        site_store.update_cache_headers = AsyncMock()
        site_store.get_total_count = AsyncMock(return_value=0)

        store_manager.update_scan_status = AsyncMock()
        store_manager.update_website_metadata = AsyncMock()
        store_manager.update_last_scanned = AsyncMock()
        store_manager.get_site_store = MagicMock(return_value=site_store)

        # Patch _head_check to skip HEAD requests — all URLs need crawling
        with patch("app.services.scheduler._bulk_head_check", new_callable=AsyncMock) as mock_head:
            mock_head.return_value = ([], urls_to_crawl, set())
            await _scan_website("example.com", store_manager, crawler_service)

        return site_store

    async def test_404_urls_marked_as_deleted(self, store_manager, mock_conn):
        urls = ["https://example.com/gone"]
        results = [_crawl_result("https://example.com/gone", 404)]

        site_store = await self._run_scan(store_manager, mock_conn, results, urls)

        site_store.mark_urls_deleted.assert_called_once_with(["https://example.com/gone"])
        site_store.increment_fail_count.assert_not_called()

    async def test_410_urls_marked_as_deleted(self, store_manager, mock_conn):
        urls = ["https://example.com/removed"]
        results = [_crawl_result("https://example.com/removed", 410)]

        site_store = await self._run_scan(store_manager, mock_conn, results, urls)

        site_store.mark_urls_deleted.assert_called_once_with(["https://example.com/removed"])
        site_store.increment_fail_count.assert_not_called()

    async def test_500_urls_increment_fail_count(self, store_manager, mock_conn):
        urls = ["https://example.com/error"]
        results = [_crawl_result("https://example.com/error", 500)]

        site_store = await self._run_scan(store_manager, mock_conn, results, urls)

        site_store.mark_urls_deleted.assert_not_called()
        site_store.increment_fail_count.assert_called_once_with(["https://example.com/error"])

    async def test_502_urls_increment_fail_count(self, store_manager, mock_conn):
        urls = ["https://example.com/bad-gw"]
        results = [_crawl_result("https://example.com/bad-gw", 502)]

        site_store = await self._run_scan(store_manager, mock_conn, results, urls)

        site_store.mark_urls_deleted.assert_not_called()
        site_store.increment_fail_count.assert_called_once()

    async def test_network_failures_increment_fail_count(self, store_manager, mock_conn):
        urls = ["https://example.com/timeout"]
        results = []  # URL not returned at all

        site_store = await self._run_scan(store_manager, mock_conn, results, urls)

        site_store.mark_urls_deleted.assert_not_called()
        site_store.increment_fail_count.assert_called_once_with(["https://example.com/timeout"])

    async def test_mixed_batch_routes_correctly(self, store_manager, mock_conn):
        urls = [
            "https://example.com/ok",
            "https://example.com/gone",
            "https://example.com/error",
            "https://example.com/timeout",
        ]
        results = [
            _crawl_result("https://example.com/ok", 200, content="Hello"),
            _crawl_result("https://example.com/gone", 404),
            _crawl_result("https://example.com/error", 500),
            # timeout URL not in results
        ]

        site_store = await self._run_scan(store_manager, mock_conn, results, urls)

        site_store.mark_urls_deleted.assert_called_once_with(["https://example.com/gone"])
        site_store.increment_fail_count.assert_called_once_with(
            ["https://example.com/error", "https://example.com/timeout"]
        )

    async def test_no_errors_skips_both_calls(self, store_manager, mock_conn):
        urls = ["https://example.com/ok"]
        results = [_crawl_result("https://example.com/ok", 200, content="Hello")]

        site_store = await self._run_scan(store_manager, mock_conn, results, urls)

        site_store.mark_urls_deleted.assert_not_called()
        site_store.increment_fail_count.assert_not_called()

    async def test_none_status_code_treated_as_transient(self, store_manager, mock_conn):
        urls = ["https://example.com/broken"]
        results = [_crawl_result("https://example.com/broken", None)]

        site_store = await self._run_scan(store_manager, mock_conn, results, urls)

        site_store.mark_urls_deleted.assert_not_called()
        site_store.increment_fail_count.assert_called_once_with(["https://example.com/broken"])

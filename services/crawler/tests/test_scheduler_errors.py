"""Tests for scheduler HTTP error classification: 404/410 → deleted, others → fail_count."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import stamina

from app.services.scheduler import _MAX_DELETION_RATIO, _PERMANENT_HTTP_ERRORS, _scan_website

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


async def _run_scan(store_manager, mock_conn, crawl_results, urls_to_crawl, total_count=0):
    """Run _scan_website with mocked dependencies, returning the site_store for assertions."""
    crawler_service = AsyncMock()
    crawler_service.initialized = True
    crawler_service.discover_urls = AsyncMock(return_value=[])
    crawler_service.crawl_urls = AsyncMock(return_value=crawl_results)

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
    site_store.get_total_count = AsyncMock(return_value=total_count)

    store_manager.update_scan_status = AsyncMock()
    store_manager.update_website_metadata = AsyncMock()
    store_manager.update_last_scanned = AsyncMock()
    store_manager.get_site_store = MagicMock(return_value=site_store)

    with patch("app.services.scheduler._bulk_head_check", new_callable=AsyncMock) as mock_head:
        mock_head.return_value = ([], urls_to_crawl, set())
        await _scan_website("example.com", store_manager, crawler_service)

    return site_store


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

    async def test_404_urls_marked_as_deleted(self, store_manager, mock_conn):
        urls = ["https://example.com/gone"]
        results = [_crawl_result("https://example.com/gone", 404)]

        site_store = await _run_scan(store_manager, mock_conn, results, urls, total_count=100)

        site_store.mark_urls_deleted.assert_called_once_with(["https://example.com/gone"])
        site_store.increment_fail_count.assert_not_called()

    async def test_410_urls_marked_as_deleted(self, store_manager, mock_conn):
        urls = ["https://example.com/removed"]
        results = [_crawl_result("https://example.com/removed", 410)]

        site_store = await _run_scan(store_manager, mock_conn, results, urls, total_count=100)

        site_store.mark_urls_deleted.assert_called_once_with(["https://example.com/removed"])
        site_store.increment_fail_count.assert_not_called()

    async def test_500_urls_increment_fail_count(self, store_manager, mock_conn):
        urls = ["https://example.com/error"]
        results = [_crawl_result("https://example.com/error", 500)]

        site_store = await _run_scan(store_manager, mock_conn, results, urls)

        site_store.mark_urls_deleted.assert_not_called()
        site_store.increment_fail_count.assert_called_once_with(["https://example.com/error"])

    async def test_502_urls_increment_fail_count(self, store_manager, mock_conn):
        urls = ["https://example.com/bad-gw"]
        results = [_crawl_result("https://example.com/bad-gw", 502)]

        site_store = await _run_scan(store_manager, mock_conn, results, urls)

        site_store.mark_urls_deleted.assert_not_called()
        site_store.increment_fail_count.assert_called_once()

    async def test_network_failures_increment_fail_count(self, store_manager, mock_conn):
        urls = ["https://example.com/timeout"]
        results = []  # URL not returned at all

        site_store = await _run_scan(store_manager, mock_conn, results, urls)

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

        site_store = await _run_scan(store_manager, mock_conn, results, urls, total_count=100)

        site_store.mark_urls_deleted.assert_called_once_with(["https://example.com/gone"])
        site_store.increment_fail_count.assert_called_once_with(
            ["https://example.com/error", "https://example.com/timeout"]
        )

    async def test_no_errors_skips_both_calls(self, store_manager, mock_conn):
        urls = ["https://example.com/ok"]
        results = [_crawl_result("https://example.com/ok", 200, content="Hello")]

        site_store = await _run_scan(store_manager, mock_conn, results, urls)

        site_store.mark_urls_deleted.assert_not_called()
        site_store.increment_fail_count.assert_not_called()

    async def test_none_status_code_treated_as_transient(self, store_manager, mock_conn):
        urls = ["https://example.com/broken"]
        results = [_crawl_result("https://example.com/broken", None)]

        site_store = await _run_scan(store_manager, mock_conn, results, urls)

        site_store.mark_urls_deleted.assert_not_called()
        site_store.increment_fail_count.assert_called_once_with(["https://example.com/broken"])


class TestMassDeletionThreshold:
    """Mass deletion guard: block deletion when >50% of URLs are 404/410 in a batch."""

    async def test_blocks_deletion_when_ratio_exceeds_threshold(self, store_manager, mock_conn):
        """When >50% of known URLs return 404, fall back to fail_count increment."""
        gone = [f"https://example.com/{i}" for i in range(4)]
        results = [_crawl_result(u, 404) for u in gone]

        site_store = await _run_scan(store_manager, mock_conn, results, gone, total_count=6)

        site_store.mark_urls_deleted.assert_not_called()
        site_store.increment_fail_count.assert_called_once_with(gone)

    async def test_allows_deletion_when_ratio_below_threshold(self, store_manager, mock_conn):
        """When <50% of known URLs return 404, proceed with deletion."""
        gone = [f"https://example.com/{i}" for i in range(4)]
        results = [_crawl_result(u, 404) for u in gone]

        site_store = await _run_scan(store_manager, mock_conn, results, gone, total_count=100)

        site_store.mark_urls_deleted.assert_called_once_with(gone)
        site_store.increment_fail_count.assert_not_called()

    async def test_allows_deletion_when_total_is_zero(self, store_manager, mock_conn):
        """When total_count is 0, ratio check is skipped (no division by zero)."""
        gone = ["https://example.com/only"]
        results = [_crawl_result(gone[0], 404)]

        site_store = await _run_scan(store_manager, mock_conn, results, gone, total_count=0)

        site_store.mark_urls_deleted.assert_called_once_with(gone)

    async def test_exactly_at_threshold_allows_deletion(self, store_manager, mock_conn):
        """When exactly 50% of URLs return 404, deletion is allowed (strict >)."""
        gone = [f"https://example.com/{i}" for i in range(5)]
        results = [_crawl_result(u, 410) for u in gone]

        site_store = await _run_scan(store_manager, mock_conn, results, gone, total_count=10)

        site_store.mark_urls_deleted.assert_called_once_with(gone)
        site_store.increment_fail_count.assert_not_called()

    async def test_threshold_constant_is_half(self):
        assert _MAX_DELETION_RATIO == 0.5

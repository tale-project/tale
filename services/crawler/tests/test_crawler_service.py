"""
Tests for CrawlerService content extraction and configuration.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.crawler_service import CrawlerService

pytestmark = pytest.mark.asyncio


def _make_crawl_result(
    url: str = "https://example.com",
    title: str = "Test Page",
    raw_markdown: str = "raw content",
    fit_markdown: str | None = "fit content",
    html: str = "<html></html>",
    success: bool = True,
    error_message: str | None = None,
    status_code: int | None = 200,
):
    """Build a fake crawl4ai CrawlResult."""
    md = SimpleNamespace(raw_markdown=raw_markdown, fit_markdown=fit_markdown)
    metadata = {"title": title}
    return SimpleNamespace(
        url=url,
        markdown=md,
        metadata=metadata,
        html=html,
        success=success,
        error_message=error_message,
        status_code=status_code,
    )


async def _run_crawl(results):
    """Helper: run crawl_urls with mocked arun_many returning given results."""
    service = CrawlerService()
    service.initialized = True
    service._crawl_count = 0

    async def fake_arun_many(urls, config):
        async def gen():
            for r in results:
                yield r

        return gen()

    service._crawler = MagicMock()
    service._crawler.arun_many = fake_arun_many

    with patch(
        "app.services.crawler_service.CrawlerService._extract_structured_data_from_html",
        return_value={},
    ):
        return await service.crawl_urls(["https://example.com"])


class TestCrawlUrlsMarkdownSelection:
    """Verify that crawl_urls prefers fit_markdown and falls back to raw_markdown."""

    async def test_uses_fit_markdown_when_available(self):
        result = _make_crawl_result(fit_markdown="clean content", raw_markdown="noisy content")
        pages = await _run_crawl([result])

        assert len(pages) == 1
        assert pages[0]["content"] == "clean content"

    async def test_falls_back_to_raw_markdown_when_fit_is_none(self):
        result = _make_crawl_result(fit_markdown=None, raw_markdown="raw content")
        pages = await _run_crawl([result])

        assert len(pages) == 1
        assert pages[0]["content"] == "raw content"

    async def test_falls_back_to_raw_markdown_when_fit_is_empty(self):
        result = _make_crawl_result(fit_markdown="", raw_markdown="raw content")
        pages = await _run_crawl([result])

        assert len(pages) == 1
        assert pages[0]["content"] == "raw content"

    async def test_skips_failed_results(self):
        result = _make_crawl_result(success=False, error_message="404")
        pages = await _run_crawl([result])

        assert len(pages) == 0

    async def test_word_count_uses_selected_markdown(self):
        result = _make_crawl_result(fit_markdown="one two three")
        pages = await _run_crawl([result])

        assert pages[0]["word_count"] == 3

    async def test_successful_result_includes_status_code(self):
        result = _make_crawl_result(status_code=200)
        pages = await _run_crawl([result])

        assert pages[0]["status_code"] == 200


class TestCrawlUrlsStatusCodeFiltering:
    """Verify that non-2xx status codes are returned with content=None."""

    async def test_502_returns_with_none_content(self):
        result = _make_crawl_result(title="502 Bad Gateway", status_code=502)
        pages = await _run_crawl([result])

        assert len(pages) == 1
        assert pages[0]["content"] is None
        assert pages[0]["status_code"] == 502

    async def test_404_returns_with_none_content(self):
        result = _make_crawl_result(title="Not Found", status_code=404)
        pages = await _run_crawl([result])

        assert len(pages) == 1
        assert pages[0]["content"] is None
        assert pages[0]["status_code"] == 404

    async def test_500_returns_with_none_content(self):
        result = _make_crawl_result(status_code=500)
        pages = await _run_crawl([result])

        assert len(pages) == 1
        assert pages[0]["content"] is None
        assert pages[0]["status_code"] == 500

    async def test_allows_200_ok(self):
        result = _make_crawl_result(status_code=200)
        pages = await _run_crawl([result])

        assert len(pages) == 1
        assert pages[0]["content"] is not None
        assert pages[0]["status_code"] == 200

    async def test_allows_none_status_code(self):
        result = _make_crawl_result(status_code=None)
        pages = await _run_crawl([result])

        assert len(pages) == 1
        assert pages[0]["content"] is not None

    async def test_mixed_batch_preserves_both(self):
        ok = _make_crawl_result(url="https://example.com/ok", status_code=200)
        bad = _make_crawl_result(url="https://example.com/bad", status_code=503)
        pages = await _run_crawl([ok, bad])

        assert len(pages) == 2
        by_url = {p["url"]: p for p in pages}
        assert by_url["https://example.com/ok"]["content"] is not None
        assert by_url["https://example.com/bad"]["content"] is None
        assert by_url["https://example.com/bad"]["status_code"] == 503

    async def test_all_non_2xx_batch(self):
        r1 = _make_crawl_result(url="https://example.com/a", status_code=502)
        r2 = _make_crawl_result(url="https://example.com/b", status_code=404)
        pages = await _run_crawl([r1, r2])

        assert len(pages) == 2
        assert all(p["content"] is None for p in pages)

    async def test_status_code_zero_treated_as_error(self):
        result = _make_crawl_result(status_code=0)
        pages = await _run_crawl([result])

        assert len(pages) == 1
        assert pages[0]["content"] is None
        assert pages[0]["status_code"] == 0


class TestCrawlerRunConfigSetup:
    """Verify that CrawlerRunConfig is created with the correct filtering options."""

    async def test_config_has_excluded_tags(self):
        """Ensure excluded_tags and content filter are set in the config."""
        captured_config = {}

        async def fake_arun_many(urls, config):
            captured_config["config"] = config

            async def gen():
                return
                yield

            return gen()

        service = CrawlerService()
        service.initialized = True
        service._crawl_count = 0
        service._crawler = MagicMock()
        service._crawler.arun_many = fake_arun_many

        await service.crawl_urls(["https://example.com"])

        config = captured_config["config"]
        assert "nav" in config.excluded_tags
        assert "footer" in config.excluded_tags
        assert "header" in config.excluded_tags
        assert "aside" in config.excluded_tags
        assert "select" in config.excluded_tags
        assert "option" in config.excluded_tags
        assert config.exclude_external_links is True
        assert config.exclude_social_media_links is True


class TestBrowserConfig:
    """Verify that BrowserConfig is created with container-optimized Chrome flags."""

    async def test_browser_config_has_container_flags(self):
        """Chrome should launch with flags that prevent zombie processes in Docker."""
        captured_config = {}

        with (
            patch("crawl4ai.BrowserConfig") as mock_bc,
            patch("crawl4ai.AsyncUrlSeeder") as mock_seeder,
            patch("crawl4ai.AsyncWebCrawler") as mock_crawler,
        ):
            mock_bc.side_effect = lambda **kwargs: captured_config.update(kwargs) or MagicMock()
            mock_seeder.return_value.__aenter__ = AsyncMock()
            mock_crawler.return_value.__aenter__ = AsyncMock()

            service = CrawlerService()
            await service.initialize()

        extra_args = captured_config["extra_args"]
        assert "--disable-dev-shm-usage" in extra_args
        assert "--disable-gpu" in extra_args
        assert "--no-zygote" in extra_args
        assert "--disable-breakpad" in extra_args
        assert "--disable-crash-reporter" in extra_args


class TestExtractStructuredData:
    """Verify structured data extraction from HTML."""

    def test_extracts_json_ld(self):
        service = CrawlerService()
        html = """
        <html>
        <head>
            <script type="application/ld+json">{"@type": "Product", "name": "Test"}</script>
        </head>
        <body></body>
        </html>
        """
        data = service._extract_structured_data_from_html(html)
        assert "json_ld" in data
        assert data["json_ld"][0]["@type"] == "Product"

    def test_extracts_opengraph(self):
        service = CrawlerService()
        html = """
        <html>
        <head>
            <meta property="og:title" content="Test Product" />
            <meta property="og:price:amount" content="49.00" />
        </head>
        <body></body>
        </html>
        """
        data = service._extract_structured_data_from_html(html)
        assert "opengraph" in data
        assert data["opengraph"]["title"] == "Test Product"

    def test_extracts_meta_tags(self):
        service = CrawlerService()
        html = """
        <html>
        <head>
            <meta name="description" content="A test page" />
            <meta name="keywords" content="test, page" />
        </head>
        <body></body>
        </html>
        """
        data = service._extract_structured_data_from_html(html)
        assert "meta" in data
        assert data["meta"]["description"] == "A test page"
        assert data["meta"]["keywords"] == "test, page"

    def test_returns_empty_dict_for_no_structured_data(self):
        service = CrawlerService()
        html = "<html><head></head><body><p>Hello</p></body></html>"
        data = service._extract_structured_data_from_html(html)
        assert data == {}

    def test_handles_malformed_json_ld(self):
        service = CrawlerService()
        html = """
        <html>
        <head>
            <script type="application/ld+json">not valid json</script>
        </head>
        <body></body>
        </html>
        """
        data = service._extract_structured_data_from_html(html)
        assert "json_ld" not in data

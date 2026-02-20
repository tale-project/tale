"""
Tests for CrawlerService content extraction and configuration.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.crawler_service import CrawlerService


def _make_crawl_result(
    url: str = "https://example.com",
    title: str = "Test Page",
    raw_markdown: str = "raw content",
    fit_markdown: str | None = "fit content",
    html: str = "<html></html>",
    success: bool = True,
    error_message: str | None = None,
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
    )


class TestCrawlUrlsMarkdownSelection:
    """Verify that crawl_urls prefers fit_markdown and falls back to raw_markdown."""

    async def _run_crawl(self, results):
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

    async def test_uses_fit_markdown_when_available(self):
        result = _make_crawl_result(fit_markdown="clean content", raw_markdown="noisy content")
        pages = await self._run_crawl([result])

        assert len(pages) == 1
        assert pages[0]["content"] == "clean content"

    async def test_falls_back_to_raw_markdown_when_fit_is_none(self):
        result = _make_crawl_result(fit_markdown=None, raw_markdown="raw content")
        pages = await self._run_crawl([result])

        assert len(pages) == 1
        assert pages[0]["content"] == "raw content"

    async def test_falls_back_to_raw_markdown_when_fit_is_empty(self):
        result = _make_crawl_result(fit_markdown="", raw_markdown="raw content")
        pages = await self._run_crawl([result])

        assert len(pages) == 1
        assert pages[0]["content"] == "raw content"

    async def test_skips_failed_results(self):
        result = _make_crawl_result(success=False, error_message="404")
        pages = await self._run_crawl([result])

        assert len(pages) == 0

    async def test_word_count_uses_selected_markdown(self):
        result = _make_crawl_result(fit_markdown="one two three")
        pages = await self._run_crawl([result])

        assert pages[0]["word_count"] == 3


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

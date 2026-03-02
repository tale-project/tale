"""Tests for CrawlerService.crawl_single_url()."""

import asyncio
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
    html: str = "<html><body>test</body></html>",
    success: bool = True,
    error_message: str | None = None,
    media: dict | None = None,
    status_code: int | None = 200,
):
    """Build a fake crawl4ai CrawlResult for single URL crawl."""
    md = SimpleNamespace(raw_markdown=raw_markdown, fit_markdown=fit_markdown)
    metadata = {"title": title}
    if media is None:
        media = {"images": [{"src": "https://example.com/img.jpg", "alt": "test", "score": 5.0}]}
    return SimpleNamespace(
        url=url,
        markdown=md,
        metadata=metadata,
        html=html,
        success=success,
        error_message=error_message,
        media=media,
        status_code=status_code,
    )


def _make_service(crawl_result=None, arun_side_effect=None):
    """Create a CrawlerService with a mocked crawler."""
    service = CrawlerService()
    service.initialized = True
    service._crawl_count = 0
    service._crawler = MagicMock()

    if arun_side_effect:
        service._crawler.arun = AsyncMock(side_effect=arun_side_effect)
    else:
        service._crawler.arun = AsyncMock(return_value=crawl_result or _make_crawl_result())

    return service


class TestCrawlSingleUrlMarkdown:
    """Verify markdown selection and content extraction."""

    async def test_uses_fit_markdown_when_available(self):
        result = _make_crawl_result(fit_markdown="clean content", raw_markdown="noisy content")
        service = _make_service(result)

        with patch.object(service, "_extract_structured_data_from_html", return_value={}):
            page = await service.crawl_single_url("https://example.com")

        assert page["content"] == "clean content"

    async def test_falls_back_to_raw_markdown_when_fit_is_none(self):
        result = _make_crawl_result(fit_markdown=None, raw_markdown="raw content")
        service = _make_service(result)

        with patch.object(service, "_extract_structured_data_from_html", return_value={}):
            page = await service.crawl_single_url("https://example.com")

        assert page["content"] == "raw content"

    async def test_falls_back_to_raw_markdown_when_fit_is_empty(self):
        result = _make_crawl_result(fit_markdown="", raw_markdown="raw content")
        service = _make_service(result)

        with patch.object(service, "_extract_structured_data_from_html", return_value={}):
            page = await service.crawl_single_url("https://example.com")

        assert page["content"] == "raw content"

    async def test_word_count_uses_selected_markdown(self):
        result = _make_crawl_result(fit_markdown="one two three four")
        service = _make_service(result)

        with patch.object(service, "_extract_structured_data_from_html", return_value={}):
            page = await service.crawl_single_url("https://example.com")

        assert page["word_count"] == 4


class TestCrawlSingleUrlMediaImages:
    """Verify media image extraction from crawl results."""

    async def test_returns_media_images(self):
        images = [
            {"src": "https://example.com/a.jpg", "alt": "Photo A", "score": 8.0},
            {"src": "https://example.com/b.png", "alt": "Photo B", "score": 3.0},
        ]
        result = _make_crawl_result(media={"images": images})
        service = _make_service(result)

        with patch.object(service, "_extract_structured_data_from_html", return_value={}):
            page = await service.crawl_single_url("https://example.com")

        assert page["media_images"] == images

    async def test_returns_empty_list_when_no_media(self):
        result = _make_crawl_result(media={})
        service = _make_service(result)

        with patch.object(service, "_extract_structured_data_from_html", return_value={}):
            page = await service.crawl_single_url("https://example.com")

        assert page["media_images"] == []

    async def test_returns_empty_list_when_media_is_none(self):
        result = _make_crawl_result()
        result.media = None
        service = _make_service(result)

        with patch.object(service, "_extract_structured_data_from_html", return_value={}):
            page = await service.crawl_single_url("https://example.com")

        assert page["media_images"] == []


class TestCrawlSingleUrlMetadata:
    """Verify metadata and structured data extraction."""

    async def test_returns_title_from_metadata(self):
        result = _make_crawl_result(title="My Page Title")
        service = _make_service(result)

        with patch.object(service, "_extract_structured_data_from_html", return_value={}):
            page = await service.crawl_single_url("https://example.com")

        assert page["title"] == "My Page Title"

    async def test_returns_none_title_when_no_metadata(self):
        result = _make_crawl_result()
        result.metadata = None
        service = _make_service(result)

        with patch.object(service, "_extract_structured_data_from_html", return_value={}):
            page = await service.crawl_single_url("https://example.com")

        assert page["title"] is None

    async def test_returns_structured_data(self):
        result = _make_crawl_result(html='<html><meta property="og:title" content="OG Title"></html>')
        service = _make_service(result)
        structured = {"opengraph": {"title": "OG Title"}}

        with patch.object(service, "_extract_structured_data_from_html", return_value=structured):
            page = await service.crawl_single_url("https://example.com")

        assert page["structured_data"] == structured


class TestCrawlSingleUrlErrorHandling:
    """Verify error handling and edge cases."""

    async def test_raises_runtime_error_on_failed_crawl(self):
        result = _make_crawl_result(success=False, error_message="Connection refused")
        service = _make_service(result)

        with pytest.raises(RuntimeError, match="Connection refused"):
            await service.crawl_single_url("https://example.com")

    async def test_raises_runtime_error_on_502_status(self):
        result = _make_crawl_result(status_code=502)
        service = _make_service(result)

        with pytest.raises(RuntimeError, match="HTTP 502"):
            await service.crawl_single_url("https://example.com")

    async def test_raises_runtime_error_on_404_status(self):
        result = _make_crawl_result(status_code=404)
        service = _make_service(result)

        with pytest.raises(RuntimeError, match="HTTP 404"):
            await service.crawl_single_url("https://example.com")

    async def test_allows_none_status_code(self):
        result = _make_crawl_result(status_code=None)
        service = _make_service(result)

        with patch.object(service, "_extract_structured_data_from_html", return_value={}):
            page = await service.crawl_single_url("https://example.com")

        assert page["content"] == "fit content"

    async def test_allows_301_redirect(self):
        result = _make_crawl_result(status_code=301)
        service = _make_service(result)

        with patch.object(service, "_extract_structured_data_from_html", return_value={}):
            page = await service.crawl_single_url("https://example.com")

        assert page["content"] == "fit content"

    async def test_allows_302_redirect(self):
        result = _make_crawl_result(status_code=302)
        service = _make_service(result)

        with patch.object(service, "_extract_structured_data_from_html", return_value={}):
            page = await service.crawl_single_url("https://example.com")

        assert page["content"] == "fit content"

    async def test_raises_timeout_error_on_slow_crawl(self):
        async def slow_arun(**kwargs):
            await asyncio.sleep(10)
            return _make_crawl_result()

        service = _make_service(arun_side_effect=slow_arun)

        with pytest.raises((TimeoutError, asyncio.TimeoutError)):
            await service.crawl_single_url("https://example.com", timeout=0.01)


class TestCrawlSingleUrlMemoryManagement:
    """Verify memory cleanup is called."""

    async def test_increments_crawl_count(self):
        result = _make_crawl_result()
        service = _make_service(result)

        with patch.object(service, "_extract_structured_data_from_html", return_value={}):
            await service.crawl_single_url("https://example.com")

        assert service._crawl_count == 1

    async def test_increments_crawl_count_even_on_failure(self):
        result = _make_crawl_result(success=False, error_message="error")
        service = _make_service(result)

        with pytest.raises(RuntimeError):
            await service.crawl_single_url("https://example.com")

        assert service._crawl_count == 1

    async def test_increments_crawl_count_on_http_error_status(self):
        result = _make_crawl_result(status_code=502)
        service = _make_service(result)

        with pytest.raises(RuntimeError):
            await service.crawl_single_url("https://example.com")

        assert service._crawl_count == 1

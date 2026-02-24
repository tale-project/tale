"""Tests for URL content type detection, routing logic, and web page extraction."""

from unittest.mock import AsyncMock, patch

import pytest

from app.models import WebFetchExtractResponse
from app.routers.web import _extract_from_webpage
from app.utils.content_type import detect_type_from_content_type, detect_type_from_url


class TestDetectTypeFromUrl:
    """Tests for URL extension-based type detection."""

    @pytest.mark.parametrize(
        "url, expected_ext, expected_category",
        [
            ("https://example.com/report.pdf", ".pdf", "document"),
            ("https://example.com/slides.pptx", ".pptx", "document"),
            ("https://example.com/doc.docx", ".docx", "document"),
            ("https://example.com/path/to/file.PDF", ".pdf", "document"),
        ],
    )
    def test_document_urls(self, url, expected_ext, expected_category):
        ext, category = detect_type_from_url(url)
        assert ext == expected_ext
        assert category == expected_category

    @pytest.mark.parametrize(
        "url, expected_ext, expected_category",
        [
            ("https://example.com/photo.png", ".png", "image"),
            ("https://example.com/photo.jpg", ".jpg", "image"),
            ("https://example.com/photo.jpeg", ".jpeg", "image"),
            ("https://example.com/anim.gif", ".gif", "image"),
            ("https://example.com/photo.webp", ".webp", "image"),
            ("https://example.com/image.bmp", ".bmp", "image"),
            ("https://example.com/scan.tiff", ".tiff", "image"),
            ("https://example.com/scan.tif", ".tif", "image"),
            ("https://example.com/logo.svg", ".svg", "image"),
        ],
    )
    def test_image_urls(self, url, expected_ext, expected_category):
        ext, category = detect_type_from_url(url)
        assert ext == expected_ext
        assert category == expected_category

    @pytest.mark.parametrize(
        "url",
        [
            "https://example.com/page",
            "https://example.com/",
            "https://example.com/api/data",
            "https://example.com/page.html",
            "https://example.com/page.php",
        ],
    )
    def test_webpage_urls(self, url):
        ext, category = detect_type_from_url(url)
        assert ext is None
        assert category == "unknown"

    def test_url_with_query_params(self):
        ext, category = detect_type_from_url("https://example.com/file.pdf?token=abc123")
        assert ext == ".pdf"
        assert category == "document"

    def test_image_url_with_query_params(self):
        ext, category = detect_type_from_url("https://cdn.example.com/image.jpg?w=800&h=600")
        assert ext == ".jpg"
        assert category == "image"


class TestDetectTypeFromContentType:
    """Tests for Content-Type header-based type detection."""

    @pytest.mark.parametrize(
        "content_type, expected_ext, expected_category",
        [
            ("application/pdf", ".pdf", "document"),
            ("application/pdf; charset=utf-8", ".pdf", "document"),
            (
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                ".docx",
                "document",
            ),
            (
                "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                ".pptx",
                "document",
            ),
            ("application/msword", ".doc", "document"),
            ("application/vnd.ms-powerpoint", ".pptx", "document"),
        ],
    )
    def test_document_content_types(self, content_type, expected_ext, expected_category):
        ext, category = detect_type_from_content_type(content_type)
        assert ext == expected_ext
        assert category == expected_category

    @pytest.mark.parametrize(
        "content_type, expected_category",
        [
            ("image/png", "image"),
            ("image/jpeg", "image"),
            ("image/gif", "image"),
            ("image/webp", "image"),
            ("image/bmp", "image"),
            ("image/tiff", "image"),
            ("image/svg+xml", "image"),
            ("image/jpeg; charset=utf-8", "image"),
        ],
    )
    def test_image_content_types(self, content_type, expected_category):
        ext, category = detect_type_from_content_type(content_type)
        assert category == expected_category
        assert ext is not None

    def test_svg_extension_strips_plus(self):
        ext, category = detect_type_from_content_type("image/svg+xml")
        assert category == "image"
        assert ext == "svg"

    @pytest.mark.parametrize(
        "content_type",
        [
            "text/html",
            "text/html; charset=utf-8",
            "application/json",
            "text/plain",
            "",
        ],
    )
    def test_webpage_content_types(self, content_type):
        ext, category = detect_type_from_content_type(content_type)
        assert ext is None
        assert category == "unknown"


class TestExtractFromWebpage:
    """Tests for _extract_from_webpage() using Crawl4AI + image extraction."""

    @patch("app.routers.web.extract_and_describe_images", new_callable=AsyncMock)
    @patch("app.routers.web.get_crawler_service")
    async def test_happy_path(self, mock_get_crawler, mock_extract_images):
        mock_crawler = AsyncMock()
        mock_crawler.initialized = True
        mock_crawler.crawl_single_url = AsyncMock(
            return_value={
                "url": "https://example.com",
                "title": "Example Page",
                "content": "Hello world content",
                "word_count": 3,
                "metadata": {"title": "Example Page"},
                "structured_data": {},
                "media_images": [{"src": "https://example.com/img.jpg", "score": 5.0}],
            }
        )
        mock_get_crawler.return_value = mock_crawler
        mock_extract_images.return_value = (["[Image: A sunset photo]"], True)

        result = await _extract_from_webpage("https://example.com", "example.com", None, 60.0)

        assert result.success is True
        assert "Hello world content" in result.content
        assert "[Image: A sunset photo]" in result.content
        assert result.title == "Example Page"
        assert result.vision_used is True
        assert result.content_type == "text/html"
        assert result.page_count == 0

    @patch("app.routers.web.extract_and_describe_images", new_callable=AsyncMock)
    @patch("app.routers.web.get_crawler_service")
    async def test_no_images_found(self, mock_get_crawler, mock_extract_images):
        mock_crawler = AsyncMock()
        mock_crawler.initialized = True
        mock_crawler.crawl_single_url = AsyncMock(
            return_value={
                "url": "https://example.com",
                "title": "Text Only",
                "content": "Just text content here",
                "word_count": 4,
                "metadata": {},
                "structured_data": {},
                "media_images": [],
            }
        )
        mock_get_crawler.return_value = mock_crawler
        mock_extract_images.return_value = ([], False)

        result = await _extract_from_webpage("https://example.com", "example.com", None, 60.0)

        assert result.success is True
        assert result.content == "Just text content here"
        assert result.vision_used is False

    @patch("app.routers.web.get_crawler_service")
    async def test_timeout_error(self, mock_get_crawler):
        mock_crawler = AsyncMock()
        mock_crawler.initialized = True
        mock_crawler.crawl_single_url = AsyncMock(side_effect=TimeoutError("timed out"))
        mock_get_crawler.return_value = mock_crawler

        result = await _extract_from_webpage("https://example.com", "example.com", None, 60.0)

        assert result.success is False
        assert "Timed out" in result.error

    @patch("app.routers.web.get_crawler_service")
    async def test_runtime_error(self, mock_get_crawler):
        mock_crawler = AsyncMock()
        mock_crawler.initialized = True
        mock_crawler.crawl_single_url = AsyncMock(side_effect=RuntimeError("Crawl failed: 404"))
        mock_get_crawler.return_value = mock_crawler

        result = await _extract_from_webpage("https://example.com", "example.com", None, 60.0)

        assert result.success is False
        assert "Crawl failed" in result.error

    @patch("app.routers.web.extract_and_describe_images", new_callable=AsyncMock)
    @patch("app.routers.web.get_crawler_service")
    async def test_instruction_triggers_llm_processing(self, mock_get_crawler, mock_extract_images):
        mock_crawler = AsyncMock()
        mock_crawler.initialized = True
        mock_crawler.crawl_single_url = AsyncMock(
            return_value={
                "url": "https://example.com",
                "title": "Test",
                "content": "Original content with lots of info",
                "word_count": 6,
                "metadata": {},
                "structured_data": {},
                "media_images": [],
            }
        )
        mock_get_crawler.return_value = mock_crawler
        mock_extract_images.return_value = ([], False)

        with patch(
            "app.services.vision.openai_client.process_pages_with_llm",
            new_callable=AsyncMock,
            return_value=["Processed extraction result"],
        ) as mock_llm:
            result = await _extract_from_webpage("https://example.com", "example.com", "Extract key facts", 60.0)

            mock_llm.assert_called_once()
            assert result.content == "Processed extraction result"

    @patch("app.routers.web.extract_and_describe_images", new_callable=AsyncMock)
    @patch("app.routers.web.get_crawler_service")
    async def test_no_instruction_skips_llm(self, mock_get_crawler, mock_extract_images):
        mock_crawler = AsyncMock()
        mock_crawler.initialized = True
        mock_crawler.crawl_single_url = AsyncMock(
            return_value={
                "url": "https://example.com",
                "title": "Test",
                "content": "Some content",
                "word_count": 2,
                "metadata": {},
                "structured_data": {},
                "media_images": [],
            }
        )
        mock_get_crawler.return_value = mock_crawler
        mock_extract_images.return_value = ([], False)

        with patch(
            "app.services.vision.openai_client.process_pages_with_llm",
            new_callable=AsyncMock,
        ) as mock_llm:
            await _extract_from_webpage("https://example.com", "example.com", None, 60.0)
            mock_llm.assert_not_called()

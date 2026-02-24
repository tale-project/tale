"""Tests for URL content type detection and routing logic."""

import pytest

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

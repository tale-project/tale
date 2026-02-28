"""Tests for PDF extraction."""

from unittest.mock import AsyncMock

import fitz
import pytest

from tale_knowledge.extraction.pdf import (
    _extract_page_text_sync,
    extract_text_from_pdf_bytes,
)


def _make_simple_pdf(text: str = "Hello World") -> bytes:
    """Create a minimal PDF with text content."""
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), text)
    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


def _make_pdf_with_image(text: str = "Caption text", image_size: int = 200) -> bytes:
    """Create a PDF page with both text and an embedded image."""
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), text)

    pixmap = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, image_size, image_size), 1)
    pixmap.set_rect(pixmap.irect, (255, 0, 0, 255))
    img_bytes = pixmap.tobytes("png")
    page.insert_image(
        fitz.Rect(72, 150, 72 + image_size, 150 + image_size), stream=img_bytes
    )
    pixmap = None

    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


def _serialize_first_page(pdf_bytes: bytes) -> bytes:
    """Serialize the first page of a PDF for use with _extract_page_text_sync."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    single = fitz.open()
    single.insert_pdf(doc, from_page=0, to_page=0)
    page_bytes = single.tobytes()
    single.close()
    doc.close()
    return page_bytes


class TestExtractPageTextSync:
    def test_text_only_page(self):
        pdf_bytes = _make_simple_pdf("Hello World")
        page_bytes = _serialize_first_page(pdf_bytes)
        result = _extract_page_text_sync(page_bytes)

        assert result["total_text_len"] > 0
        assert any("Hello World" in el[1] for el in result["elements"])
        assert result["images"] == []

    def test_page_with_image(self):
        pdf_bytes = _make_pdf_with_image("Caption text", image_size=200)
        page_bytes = _serialize_first_page(pdf_bytes)
        result = _extract_page_text_sync(page_bytes)

        assert any("Caption text" in el[1] for el in result["elements"])
        assert len(result["images"]) > 0
        y0, img_bytes = result["images"][0]
        assert isinstance(img_bytes, bytes)
        assert len(img_bytes) > 0

    def test_small_image_filtered_out(self):
        pdf_bytes = _make_pdf_with_image("Some text", image_size=5)
        page_bytes = _serialize_first_page(pdf_bytes)
        result = _extract_page_text_sync(page_bytes)

        assert result["images"] == []


class TestExtractTextFromPdfBytes:
    @pytest.mark.asyncio
    async def test_digital_pdf_extraction(self):
        pdf_bytes = _make_simple_pdf("Hello World")
        text, vision_used = await extract_text_from_pdf_bytes(pdf_bytes)
        assert "Hello World" in text
        assert vision_used is False

    @pytest.mark.asyncio
    async def test_multi_page_pdf(self):
        doc = fitz.open()
        for i in range(3):
            page = doc.new_page()
            page.insert_text((72, 72), f"Page {i + 1} content")
        pdf_bytes = doc.tobytes()
        doc.close()

        text, vision_used = await extract_text_from_pdf_bytes(pdf_bytes)
        assert "Page 1" in text
        assert "Page 2" in text
        assert "Page 3" in text
        assert vision_used is False

    @pytest.mark.asyncio
    async def test_empty_pdf(self):
        doc = fitz.open()
        doc.new_page()
        pdf_bytes = doc.tobytes()
        doc.close()

        text, vision_used = await extract_text_from_pdf_bytes(
            pdf_bytes, ocr_scanned_pages=False
        )
        assert "--- Page 1 ---" in text

    @pytest.mark.asyncio
    async def test_no_vision_without_client(self):
        pdf_bytes = _make_simple_pdf("Digital text only")
        text, vision_used = await extract_text_from_pdf_bytes(
            pdf_bytes, vision_client=None
        )
        assert "Digital text only" in text
        assert vision_used is False

    @pytest.mark.asyncio
    async def test_image_described_with_vision_client(self):
        long_text = "This is a detailed report with charts and analysis data included"
        pdf_bytes = _make_pdf_with_image(long_text, image_size=200)

        mock_client = AsyncMock()
        mock_client.max_concurrent_pages = 3
        mock_client.pdf_dpi = 200
        mock_client.describe_image = AsyncMock(return_value="A red square image")

        text, vision_used = await extract_text_from_pdf_bytes(
            pdf_bytes, vision_client=mock_client
        )
        assert long_text in text
        assert "[Image: A red square image]" in text
        assert vision_used is True
        mock_client.describe_image.assert_called()

    @pytest.mark.asyncio
    async def test_image_skipped_without_vision_client(self):
        long_text = "This document has embedded images but no vision client provided"
        pdf_bytes = _make_pdf_with_image(long_text, image_size=200)
        text, vision_used = await extract_text_from_pdf_bytes(
            pdf_bytes, vision_client=None
        )
        assert long_text in text
        assert "[Image:" not in text
        assert vision_used is False

    @pytest.mark.asyncio
    async def test_image_skipped_when_process_images_false(self):
        long_text = "This document has images but process_images is disabled here"
        pdf_bytes = _make_pdf_with_image(long_text, image_size=200)

        mock_client = AsyncMock()
        mock_client.max_concurrent_pages = 3
        mock_client.pdf_dpi = 200

        text, vision_used = await extract_text_from_pdf_bytes(
            pdf_bytes, vision_client=mock_client, process_images=False
        )
        assert long_text in text
        assert "[Image:" not in text
        mock_client.describe_image.assert_not_called()

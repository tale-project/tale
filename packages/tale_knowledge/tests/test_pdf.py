"""Tests for PDF extraction (digital text only — Vision tests require mocking)."""

import pytest

from tale_knowledge.extraction.pdf import extract_text_from_pdf_bytes


def _make_simple_pdf(text: str = "Hello World") -> bytes:
    """Create a minimal PDF with text content."""
    import fitz

    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), text)
    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


class TestExtractTextFromPdfBytes:
    @pytest.mark.asyncio
    async def test_digital_pdf_extraction(self):
        pdf_bytes = _make_simple_pdf("Hello World")
        text, vision_used = await extract_text_from_pdf_bytes(pdf_bytes)
        assert "Hello World" in text
        assert vision_used is False

    @pytest.mark.asyncio
    async def test_multi_page_pdf(self):
        import fitz

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
        import fitz

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

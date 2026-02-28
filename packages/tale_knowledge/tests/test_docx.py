"""Tests for DOCX extraction."""

import pytest

from tale_knowledge.extraction.docx import extract_text_from_docx_bytes


def _make_simple_docx(text: str = "Hello World") -> bytes:
    """Create a minimal DOCX with text content."""
    from io import BytesIO

    from docx import Document

    doc = Document()
    doc.add_paragraph(text)
    buf = BytesIO()
    doc.save(buf)
    return buf.getvalue()


class TestExtractTextFromDocxBytes:
    @pytest.mark.asyncio
    async def test_basic_text_extraction(self):
        docx_bytes = _make_simple_docx("Hello World")
        text, vision_used = await extract_text_from_docx_bytes(docx_bytes)
        assert "Hello World" in text
        assert vision_used is False

    @pytest.mark.asyncio
    async def test_multiple_paragraphs(self):
        from io import BytesIO

        from docx import Document

        doc = Document()
        doc.add_paragraph("First paragraph")
        doc.add_paragraph("Second paragraph")
        doc.add_paragraph("Third paragraph")
        buf = BytesIO()
        doc.save(buf)

        text, _ = await extract_text_from_docx_bytes(buf.getvalue())
        assert "First paragraph" in text
        assert "Second paragraph" in text
        assert "Third paragraph" in text

    @pytest.mark.asyncio
    async def test_table_extraction(self):
        from io import BytesIO

        from docx import Document

        doc = Document()
        table = doc.add_table(rows=2, cols=2)
        table.cell(0, 0).text = "A1"
        table.cell(0, 1).text = "B1"
        table.cell(1, 0).text = "A2"
        table.cell(1, 1).text = "B2"
        buf = BytesIO()
        doc.save(buf)

        text, _ = await extract_text_from_docx_bytes(buf.getvalue())
        assert "A1" in text
        assert "B1" in text
        assert "[Table]" in text

    @pytest.mark.asyncio
    async def test_no_vision_without_client(self):
        docx_bytes = _make_simple_docx("No vision needed")
        text, vision_used = await extract_text_from_docx_bytes(
            docx_bytes, vision_client=None
        )
        assert "No vision needed" in text
        assert vision_used is False

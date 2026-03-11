"""Tests for _normalize_markdown_headings in base_converter."""

import pytest

from app.services.base_converter import _normalize_markdown_headings


class TestNormalizeMarkdownHeadings:
    def test_heading_after_table_row(self):
        md = "| a | b |\n|---|---|\n| c | d |\n### Heading"
        result = _normalize_markdown_headings(md)
        assert "| c | d |\n\n### Heading" in result

    def test_heading_after_paragraph(self):
        md = "Some text\n### Heading"
        result = _normalize_markdown_headings(md)
        assert result == "Some text\n\n### Heading"

    def test_heading_already_has_blank_line(self):
        md = "Some text\n\n### Heading"
        result = _normalize_markdown_headings(md)
        assert result == "Some text\n\n### Heading"

    def test_heading_at_start_of_document(self):
        md = "# Title\nSome text"
        result = _normalize_markdown_headings(md)
        assert result == "# Title\nSome text"

    def test_consecutive_headings(self):
        md = "## Section\n### Subsection"
        result = _normalize_markdown_headings(md)
        assert result == "## Section\n\n### Subsection"

    def test_hash_inside_fenced_code_block(self):
        md = "```python\n# comment\ndef foo():\n    pass\n```"
        result = _normalize_markdown_headings(md)
        assert result == md

    def test_hash_inside_tilde_fence(self):
        md = "~~~\n# not a heading\n~~~"
        result = _normalize_markdown_headings(md)
        assert result == md

    def test_heading_after_code_block(self):
        md = "```\ncode\n```\n## Heading"
        result = _normalize_markdown_headings(md)
        assert "```\n\n## Heading" in result

    def test_hash_in_middle_of_line_unchanged(self):
        md = "Use the # symbol for headings"
        result = _normalize_markdown_headings(md)
        assert result == md

    def test_multiple_headings_with_tables(self):
        md = "### Section A\n| h1 | h2 |\n|---|---|\n| c1 | c2 |\n### Section B\n| h3 | h4 |\n|---|---|\n| c3 | c4 |"
        result = _normalize_markdown_headings(md)
        assert "| c2 |\n\n### Section B" in result

    def test_empty_input(self):
        assert _normalize_markdown_headings("") == ""

    def test_no_headings(self):
        md = "Just some text\nAnother line"
        result = _normalize_markdown_headings(md)
        assert result == md


class TestMarkdownToHtmlHeadings:
    """Integration tests verifying headings produce correct HTML tags."""

    @pytest.mark.asyncio
    async def test_heading_after_table_produces_h3(self):
        from app.services.base_converter import BaseConverterService

        converter = BaseConverterService()
        md = "| a | b |\n|---|---|\n| c | d |\n### Heading"
        html = await converter.markdown_to_html(md)
        assert "<h3" in html
        assert "Heading</h3>" in html

    @pytest.mark.asyncio
    async def test_heading_not_swallowed_by_table(self):
        from app.services.base_converter import BaseConverterService

        converter = BaseConverterService()
        md = "### Section A\n\n| h1 | h2 |\n|---|---|\n| c1 | c2 |\n### Section B\n\nSome text."
        html = await converter.markdown_to_html(md)
        assert html.count("</h3>") == 2

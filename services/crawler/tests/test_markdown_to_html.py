"""Tests for markdown_to_html in base_converter.

Verifies CommonMark-compliant parsing via markdown-it-py, including
leading-space headings, table interactions, and fenced code blocks.
"""

import pytest

from app.services.base_converter import BaseConverterService


@pytest.fixture
def converter():
    return BaseConverterService()


class TestHeadingParsing:
    """ATX headings with various leading-space patterns."""

    @pytest.mark.asyncio
    async def test_heading_no_leading_space(self, converter):
        html = await converter.markdown_to_html("# Heading")
        assert "<h1>" in html

    @pytest.mark.asyncio
    @pytest.mark.parametrize("spaces", [1, 2, 3])
    async def test_heading_with_leading_spaces(self, converter, spaces):
        md = " " * spaces + "## Heading"
        html = await converter.markdown_to_html(md)
        assert "<h2>" in html

    @pytest.mark.asyncio
    async def test_four_spaces_is_code_block(self, converter):
        html = await converter.markdown_to_html("    # Not a heading")
        assert "<h1>" not in html
        assert "<code>" in html

    @pytest.mark.asyncio
    async def test_all_heading_levels(self, converter):
        md = "\n\n".join(f"{'#' * i} Level {i}" for i in range(1, 7))
        html = await converter.markdown_to_html(md)
        for i in range(1, 7):
            assert f"<h{i}>" in html


class TestHeadingAfterTable:
    """Headings following tables — the original bug that motivated normalization."""

    @pytest.mark.asyncio
    async def test_heading_after_table_no_blank_line(self, converter):
        md = "| a | b |\n|---|---|\n| c | d |\n### Heading"
        html = await converter.markdown_to_html(md)
        assert "<h3>" in html
        assert "<table>" in html

    @pytest.mark.asyncio
    async def test_heading_after_table_with_blank_line(self, converter):
        md = "| a | b |\n|---|---|\n| c | d |\n\n### Heading"
        html = await converter.markdown_to_html(md)
        assert "<h3>" in html
        assert "<table>" in html

    @pytest.mark.asyncio
    async def test_multiple_tables_with_headings(self, converter):
        md = "### A\n\n| h1 | h2 |\n|---|---|\n| c1 | c2 |\n### B\n\n| h3 | h4 |\n|---|---|\n| c3 | c4 |"
        html = await converter.markdown_to_html(md)
        assert html.count("</h3>") == 2
        assert html.count("</table>") == 2


class TestFencedCodeBlocks:
    """Hash characters inside code fences must not become headings."""

    @pytest.mark.asyncio
    async def test_hash_in_backtick_fence(self, converter):
        md = "```python\n# comment\ndef foo():\n    pass\n```"
        html = await converter.markdown_to_html(md)
        assert "<h1>" not in html
        assert "# comment" in html

    @pytest.mark.asyncio
    async def test_hash_in_tilde_fence(self, converter):
        md = "~~~\n# not a heading\n~~~"
        html = await converter.markdown_to_html(md)
        assert "<h1>" not in html

    @pytest.mark.asyncio
    async def test_heading_after_code_block(self, converter):
        md = "```\ncode\n```\n## Heading"
        html = await converter.markdown_to_html(md)
        assert "<h2>" in html


class TestInlineFormatting:
    """Bold, italic, and other inline syntax."""

    @pytest.mark.asyncio
    async def test_bold_text(self, converter):
        html = await converter.markdown_to_html("**bold text**")
        assert "<strong>" in html

    @pytest.mark.asyncio
    async def test_italic_text(self, converter):
        html = await converter.markdown_to_html("*italic*")
        assert "<em>" in html


class TestRealisticLLMOutput:
    """End-to-end test with actual LLM output patterns."""

    @pytest.mark.asyncio
    async def test_contract_comparison_report(self, converter):
        md = """ # Bericht zum Vertragsvergleich

**Dokumentenversionen:** file1.docx → file2.docx → file3.docx

**Anzahl analysierter Versionstransitionen:** 2

---

# Zentrale Erkenntnisse

### Verhandlungsverlauf

Der Verhandlungsprozess durchläuft einen fundamentalen Strukturwandel.

### Risikoverlagerungen

Die Risikoallokation erfährt eine bemerkenswerte Pendelbewegung.

### Methodik

Deterministischer Textvergleich auf Absatzebene."""

        html = await converter.markdown_to_html(md)
        assert html.count("<h1>") == 2
        assert html.count("<h3>") == 3
        assert "<strong>" in html
        assert "<hr" in html

    @pytest.mark.asyncio
    async def test_frequency_table_section(self, converter):
        md = """ ### Am häufigsten verhandelte Klauseln

| Clause Family | Substantive | Editorial | Total |
|---|---|---|---|
| Allgemeine Bestimmungen | 6 | 3 | 11 |
| Schadloshaltungen | 8 | 0 | 8 |

---

# Detaillierte Evolutionsanalyse"""

        html = await converter.markdown_to_html(md)
        assert "<h3>" in html
        assert "<table>" in html
        assert "<h1>" in html
        assert "<hr" in html

import unicodedata

from app.utils.paragraph_dedup import (
    BOILERPLATE_FREQUENCY_THRESHOLD,
    MIN_DOMAIN_PAGES_FOR_DEDUP,
    extract_paragraph_hashes,
    filter_boilerplate_paragraphs,
    paragraph_hash,
)


class TestParagraphHash:
    def test_deterministic(self):
        assert paragraph_hash("hello world") == paragraph_hash("hello world")

    def test_different_content_different_hash(self):
        assert paragraph_hash("hello") != paragraph_hash("world")

    def test_strips_whitespace(self):
        assert paragraph_hash("  hello  ") == paragraph_hash("hello")
        assert paragraph_hash("\nhello\n") == paragraph_hash("hello")

    def test_unicode_nfc_normalization(self):
        nfc = unicodedata.normalize("NFC", "café")
        nfd = unicodedata.normalize("NFD", "café")
        assert nfc.encode() != nfd.encode()
        assert paragraph_hash(nfc) == paragraph_hash(nfd)

    def test_returns_hex_string(self):
        h = paragraph_hash("test")
        assert isinstance(h, str)
        assert len(h) == 32
        assert all(c in "0123456789abcdef" for c in h)


class TestExtractParagraphHashes:
    def test_single_paragraph(self):
        result = extract_paragraph_hashes("Hello world")
        assert len(result) == 1

    def test_multiple_paragraphs(self):
        content = "First paragraph\n\nSecond paragraph\n\nThird paragraph"
        result = extract_paragraph_hashes(content)
        assert len(result) == 3

    def test_deduplicates_within_page(self):
        content = "Same text\n\nSame text\n\nDifferent text"
        result = extract_paragraph_hashes(content)
        assert len(result) == 2

    def test_skips_empty_paragraphs(self):
        content = "First\n\n\n\n\n\nSecond"
        result = extract_paragraph_hashes(content)
        assert len(result) == 2

    def test_skips_whitespace_only_paragraphs(self):
        content = "First\n\n   \n\nSecond"
        result = extract_paragraph_hashes(content)
        assert len(result) == 2

    def test_empty_content(self):
        assert extract_paragraph_hashes("") == []

    def test_whitespace_only_content(self):
        assert extract_paragraph_hashes("   \n\n   ") == []

    def test_preserves_order(self):
        content = "AAA\n\nBBB\n\nCCC"
        result = extract_paragraph_hashes(content)
        assert result[0] == paragraph_hash("AAA")
        assert result[1] == paragraph_hash("BBB")
        assert result[2] == paragraph_hash("CCC")

    def test_strips_outer_whitespace(self):
        content = "  \n\nHello\n\nWorld\n\n  "
        result = extract_paragraph_hashes(content)
        assert len(result) == 2

    def test_code_block_as_single_paragraph(self):
        code = "```python\ndef hello():\n    print('world')\n```"
        content = f"Intro text\n\n{code}\n\nOutro text"
        result = extract_paragraph_hashes(content)
        assert len(result) == 3

    def test_table_as_single_paragraph(self):
        table = "| A | B |\n|---|---|\n| 1 | 2 |"
        content = f"Before\n\n{table}\n\nAfter"
        result = extract_paragraph_hashes(content)
        assert len(result) == 3


class TestFilterBoilerplateParagraphs:
    def test_removes_high_frequency_paragraphs(self):
        content = "Boilerplate text\n\nUnique content here"
        frequencies = {
            paragraph_hash("Boilerplate text"): 0.8,
            paragraph_hash("Unique content here"): 0.1,
        }
        result = filter_boilerplate_paragraphs(content, frequencies)
        assert "Boilerplate text" not in result
        assert "Unique content here" in result

    def test_keeps_low_frequency_paragraphs(self):
        content = "Unique A\n\nUnique B"
        frequencies = {
            paragraph_hash("Unique A"): 0.1,
            paragraph_hash("Unique B"): 0.2,
        }
        result = filter_boilerplate_paragraphs(content, frequencies)
        assert "Unique A" in result
        assert "Unique B" in result

    def test_empty_frequencies_returns_unchanged(self):
        content = "Some content\n\nMore content"
        result = filter_boilerplate_paragraphs(content, {})
        assert result == content.strip()

    def test_all_filtered_returns_empty(self):
        content = "Boilerplate A\n\nBoilerplate B"
        frequencies = {
            paragraph_hash("Boilerplate A"): 0.9,
            paragraph_hash("Boilerplate B"): 0.8,
        }
        result = filter_boilerplate_paragraphs(content, frequencies)
        assert result == ""

    def test_threshold_boundary_keeps_at_threshold(self):
        content = "Boundary text\n\nOther text"
        frequencies = {
            paragraph_hash("Boundary text"): 0.5,
            paragraph_hash("Other text"): 0.1,
        }
        result = filter_boilerplate_paragraphs(content, frequencies, threshold=0.5)
        assert "Boundary text" in result
        assert "Other text" in result

    def test_threshold_boundary_removes_above(self):
        content = "Boundary text\n\nOther text"
        frequencies = {
            paragraph_hash("Boundary text"): 0.51,
            paragraph_hash("Other text"): 0.1,
        }
        result = filter_boilerplate_paragraphs(content, frequencies, threshold=0.5)
        assert "Boundary text" not in result
        assert "Other text" in result

    def test_unknown_paragraphs_kept(self):
        content = "Known\n\nUnknown"
        frequencies = {paragraph_hash("Known"): 0.1}
        result = filter_boilerplate_paragraphs(content, frequencies)
        assert "Known" in result
        assert "Unknown" in result

    def test_custom_threshold(self):
        content = "Text A\n\nText B"
        frequencies = {
            paragraph_hash("Text A"): 0.3,
            paragraph_hash("Text B"): 0.1,
        }
        result = filter_boilerplate_paragraphs(content, frequencies, threshold=0.2)
        assert "Text A" not in result
        assert "Text B" in result

    def test_preserves_paragraph_order(self):
        content = "First\n\nBoilerplate\n\nSecond\n\nThird"
        frequencies = {paragraph_hash("Boilerplate"): 0.9}
        result = filter_boilerplate_paragraphs(content, frequencies)
        assert result == "First\n\nSecond\n\nThird"


class TestConstants:
    def test_default_threshold(self):
        assert BOILERPLATE_FREQUENCY_THRESHOLD == 0.5

    def test_min_pages(self):
        assert MIN_DOMAIN_PAGES_FOR_DEDUP == 5


class TestIntegrationScenarios:
    def test_cmp_vendor_list_filtered(self):
        """CMP vendor list identical on all pages should be filtered."""
        boilerplate = "## Artsai\nPrivacy policy\nConsent"
        pages = [(f"https://example.com/page{i}", f"Unique content for page {i}\n\n{boilerplate}") for i in range(10)]

        all_hashes: dict[str, set[str]] = {}
        for url, content in pages:
            for h in extract_paragraph_hashes(content):
                if h not in all_hashes:
                    all_hashes[h] = set()
                all_hashes[h].add(url)

        frequencies = {h: len(urls) / len(pages) for h, urls in all_hashes.items()}

        boilerplate_hash = paragraph_hash(boilerplate)
        assert frequencies[boilerplate_hash] == 1.0

        filtered = filter_boilerplate_paragraphs(pages[0][1], frequencies)
        assert "Artsai" not in filtered
        assert "Unique content for page 0" in filtered

    def test_unique_code_not_filtered(self):
        """Code examples unique per page should never be filtered."""
        pages = [
            (
                f"https://example.com/page{i}",
                f"```python\ndef func_{i}():\n    return {i}\n```\n\nExplanation for function {i}",
            )
            for i in range(10)
        ]

        all_hashes: dict[str, set[str]] = {}
        for url, content in pages:
            for h in extract_paragraph_hashes(content):
                if h not in all_hashes:
                    all_hashes[h] = set()
                all_hashes[h].add(url)

        frequencies = {h: len(urls) / len(pages) for h, urls in all_hashes.items()}

        for _url, content in pages:
            filtered = filter_boilerplate_paragraphs(content, frequencies)
            assert filtered.strip() == content.strip()

    def test_mixed_content_selective_filtering(self):
        """Shared boilerplate filtered while unique content preserved."""
        shared_footer = "Contact us at info@example.com"
        shared_nav = "Home | About | Products | Contact"

        pages = []
        for i in range(10):
            content = (
                f"# Article {i}\n\nThis is the body of article {i} with unique insights."
                f"\n\n{shared_footer}\n\n{shared_nav}"
            )
            pages.append((f"https://example.com/article{i}", content))

        all_hashes: dict[str, set[str]] = {}
        for url, content in pages:
            for h in extract_paragraph_hashes(content):
                if h not in all_hashes:
                    all_hashes[h] = set()
                all_hashes[h].add(url)

        frequencies = {h: len(urls) / len(pages) for h, urls in all_hashes.items()}

        filtered = filter_boilerplate_paragraphs(pages[3][1], frequencies)
        assert "Article 3" in filtered
        assert "body of article 3" in filtered
        assert "Contact us" not in filtered
        assert "Home | About" not in filtered

    def test_small_domain_no_filtering(self):
        """Domain with fewer than MIN_DOMAIN_PAGES_FOR_DEDUP gets no filtering."""
        pages = [(f"https://small.com/page{i}", f"Content {i}\n\nShared text") for i in range(3)]

        all_hashes: dict[str, set[str]] = {}
        for url, content in pages:
            for h in extract_paragraph_hashes(content):
                if h not in all_hashes:
                    all_hashes[h] = set()
                all_hashes[h].add(url)

        total = len(pages)
        assert total < MIN_DOMAIN_PAGES_FOR_DEDUP
        frequencies: dict[str, float] = {}

        filtered = filter_boilerplate_paragraphs(pages[0][1], frequencies)
        assert "Shared text" in filtered

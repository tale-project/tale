import unicodedata

from app.utils.paragraph_dedup import (
    BOILERPLATE_PAGE_THRESHOLD,
    MIN_DOMAIN_PAGES_FOR_DEDUP,
    MIN_LINE_LENGTH,
    extract_paragraph_hashes,
    filter_boilerplate_paragraphs,
    paragraph_hash,
)


class TestParagraphHash:
    def test_deterministic(self):
        assert paragraph_hash("hello world") == paragraph_hash("hello world")

    def test_different_content_different_hash(self):
        assert paragraph_hash("hello world one") != paragraph_hash("hello world two")

    def test_strips_whitespace(self):
        assert paragraph_hash("  hello world  ") == paragraph_hash("hello world")
        assert paragraph_hash("\nhello world\n") == paragraph_hash("hello world")

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
    def test_single_line(self):
        result = extract_paragraph_hashes("Hello world content here")
        assert len(result) == 1

    def test_multiple_lines(self):
        content = "First paragraph line\nSecond paragraph line\nThird paragraph line"
        result = extract_paragraph_hashes(content)
        assert len(result) == 3

    def test_deduplicates_within_page(self):
        content = "Same text repeated here\nSame text repeated here\nDifferent text content"
        result = extract_paragraph_hashes(content)
        assert len(result) == 2

    def test_skips_empty_lines(self):
        content = "First line content\n\n\nSecond line content"
        result = extract_paragraph_hashes(content)
        assert len(result) == 2

    def test_skips_whitespace_only_lines(self):
        content = "First line content\n   \nSecond line content"
        result = extract_paragraph_hashes(content)
        assert len(result) == 2

    def test_skips_short_lines(self):
        content = "Short\nAlso tiny\nThis line is long enough to hash"
        result = extract_paragraph_hashes(content)
        assert len(result) == 1
        assert result[0] == paragraph_hash("This line is long enough to hash")

    def test_empty_content(self):
        assert extract_paragraph_hashes("") == []

    def test_whitespace_only_content(self):
        assert extract_paragraph_hashes("   \n\n   ") == []

    def test_preserves_order(self):
        content = "AAAA content line\nBBBB content line\nCCCC content line"
        result = extract_paragraph_hashes(content)
        assert result[0] == paragraph_hash("AAAA content line")
        assert result[1] == paragraph_hash("BBBB content line")
        assert result[2] == paragraph_hash("CCCC content line")

    def test_strips_outer_whitespace(self):
        content = "  \nHello world content\nWorld hello content\n  "
        result = extract_paragraph_hashes(content)
        assert len(result) == 2

    def test_code_block_lines_individually_hashed(self):
        code = "```python\ndef hello_world():\n    print('hello world')\n```"
        content = f"Intro text for the article\n{code}\nOutro text for the article"
        result = extract_paragraph_hashes(content)
        assert paragraph_hash("Intro text for the article") in result
        assert paragraph_hash("Outro text for the article") in result

    def test_table_lines_individually_hashed(self):
        table = "| Column A | Column B |\n|----------|----------|\n| value 1  | value 2  |"
        content = f"Before the table content\n{table}\nAfter the table content"
        result = extract_paragraph_hashes(content)
        assert paragraph_hash("Before the table content") in result
        assert paragraph_hash("After the table content") in result

    def test_double_newline_paragraphs_split_into_lines(self):
        content = "Line one is long enough\n\nLine two is long enough\n\nLine three is long enough"
        result = extract_paragraph_hashes(content)
        assert len(result) == 3

    def test_min_length_boundary(self):
        short = "a" * (MIN_LINE_LENGTH - 1)
        exact = "a" * MIN_LINE_LENGTH
        content = f"{short}\n{exact}"
        result = extract_paragraph_hashes(content)
        assert len(result) == 1
        assert result[0] == paragraph_hash(exact)


class TestFilterBoilerplateParagraphs:
    def test_removes_high_count_lines(self):
        content = "Boilerplate text here\nUnique content here today"
        page_counts = {
            paragraph_hash("Boilerplate text here"): 50,
            paragraph_hash("Unique content here today"): 2,
        }
        result = filter_boilerplate_paragraphs(content, page_counts)
        assert "Boilerplate text here" not in result
        assert "Unique content here today" in result

    def test_keeps_low_count_lines(self):
        content = "Unique A long enough\nUnique B long enough"
        page_counts = {
            paragraph_hash("Unique A long enough"): 3,
            paragraph_hash("Unique B long enough"): 5,
        }
        result = filter_boilerplate_paragraphs(content, page_counts)
        assert "Unique A long enough" in result
        assert "Unique B long enough" in result

    def test_empty_page_counts_returns_unchanged(self):
        content = "Some content here\nMore content here"
        result = filter_boilerplate_paragraphs(content, {})
        assert result == content

    def test_all_filtered_returns_empty_lines(self):
        content = "Boilerplate A text\nBoilerplate B text"
        page_counts = {
            paragraph_hash("Boilerplate A text"): 100,
            paragraph_hash("Boilerplate B text"): 80,
        }
        result = filter_boilerplate_paragraphs(content, page_counts)
        assert result.strip() == ""

    def test_threshold_boundary_keeps_at_threshold(self):
        content = "Boundary text content\nOther text content"
        page_counts = {
            paragraph_hash("Boundary text content"): 20,
            paragraph_hash("Other text content"): 3,
        }
        result = filter_boilerplate_paragraphs(content, page_counts, threshold=20)
        assert "Boundary text content" in result
        assert "Other text content" in result

    def test_threshold_boundary_removes_above(self):
        content = "Boundary text content\nOther text content"
        page_counts = {
            paragraph_hash("Boundary text content"): 21,
            paragraph_hash("Other text content"): 3,
        }
        result = filter_boilerplate_paragraphs(content, page_counts, threshold=20)
        assert "Boundary text content" not in result
        assert "Other text content" in result

    def test_unknown_lines_kept(self):
        content = "Known text content\nUnknown text content"
        page_counts = {paragraph_hash("Known text content"): 5}
        result = filter_boilerplate_paragraphs(content, page_counts)
        assert "Known text content" in result
        assert "Unknown text content" in result

    def test_custom_threshold(self):
        content = "Text A long enough\nText B long enough"
        page_counts = {
            paragraph_hash("Text A long enough"): 15,
            paragraph_hash("Text B long enough"): 3,
        }
        result = filter_boilerplate_paragraphs(content, page_counts, threshold=10)
        assert "Text A long enough" not in result
        assert "Text B long enough" in result

    def test_preserves_line_order(self):
        content = "First line content\nBoilerplate content\nSecond line content\nThird line content"
        page_counts = {paragraph_hash("Boilerplate content"): 100}
        result = filter_boilerplate_paragraphs(content, page_counts)
        lines = [l for l in result.split("\n") if l.strip()]
        assert lines == ["First line content", "Second line content", "Third line content"]

    def test_short_lines_always_kept(self):
        content = "Short\nBoilerplate text here\nUnique text here"
        page_counts = {
            paragraph_hash("Short"): 100,
            paragraph_hash("Boilerplate text here"): 100,
            paragraph_hash("Unique text here"): 2,
        }
        result = filter_boilerplate_paragraphs(content, page_counts)
        assert "Short" in result
        assert "Boilerplate text here" not in result
        assert "Unique text here" in result

    def test_preserves_blank_lines(self):
        content = "First line content\n\nSecond line content"
        result = filter_boilerplate_paragraphs(content, {})
        assert result == content


class TestConstants:
    def test_default_threshold(self):
        assert BOILERPLATE_PAGE_THRESHOLD == 5

    def test_min_pages(self):
        assert MIN_DOMAIN_PAGES_FOR_DEDUP == 5

    def test_min_line_length(self):
        assert MIN_LINE_LENGTH == 10


class TestIntegrationScenarios:
    def test_cookie_banner_filtered(self):
        """Cookie banner identical on all pages should be filtered."""
        boilerplate = 'By clicking "Allow All", you agree to the storing of cookies'
        pages = [
            (f"https://example.com/page{i}", f"Unique content for page {i} article\n{boilerplate}") for i in range(30)
        ]

        all_hashes: dict[str, set[str]] = {}
        for url, content in pages:
            for h in extract_paragraph_hashes(content):
                if h not in all_hashes:
                    all_hashes[h] = set()
                all_hashes[h].add(url)

        page_counts = {h: len(urls) for h, urls in all_hashes.items()}

        boilerplate_hash = paragraph_hash(boilerplate)
        assert page_counts[boilerplate_hash] == 30

        filtered = filter_boilerplate_paragraphs(pages[0][1], page_counts)
        assert "Allow All" not in filtered
        assert "Unique content for page 0" in filtered

    def test_unique_code_not_filtered(self):
        """Code examples unique per page should never be filtered."""
        pages = [
            (
                f"https://example.com/page{i}",
                f"def func_{i}(): return {i}\nExplanation for function number {i}",
            )
            for i in range(30)
        ]

        all_hashes: dict[str, set[str]] = {}
        for url, content in pages:
            for h in extract_paragraph_hashes(content):
                if h not in all_hashes:
                    all_hashes[h] = set()
                all_hashes[h].add(url)

        page_counts = {h: len(urls) for h, urls in all_hashes.items()}

        for _url, content in pages:
            filtered = filter_boilerplate_paragraphs(content, page_counts)
            assert filtered.strip() == content.strip()

    def test_mixed_content_selective_filtering(self):
        """Shared boilerplate filtered while unique content preserved."""
        shared_footer = "Contact us at info@example.com for more details"
        shared_nav = "Home | About | Products | Contact Us"

        pages = []
        for i in range(30):
            content = (
                f"# Article {i} with unique insights"
                f"\nThis is the body of article {i} with unique insights."
                f"\n{shared_footer}\n{shared_nav}"
            )
            pages.append((f"https://example.com/article{i}", content))

        all_hashes: dict[str, set[str]] = {}
        for url, content in pages:
            for h in extract_paragraph_hashes(content):
                if h not in all_hashes:
                    all_hashes[h] = set()
                all_hashes[h].add(url)

        page_counts = {h: len(urls) for h, urls in all_hashes.items()}

        filtered = filter_boilerplate_paragraphs(pages[3][1], page_counts)
        assert "Article 3" in filtered
        assert "body of article 3" in filtered
        assert "Contact us" not in filtered
        assert "Home | About" not in filtered

    def test_small_domain_no_filtering(self):
        """Domain with fewer than MIN_DOMAIN_PAGES_FOR_DEDUP gets no filtering."""
        pages = [(f"https://small.com/page{i}", f"Content {i} line here\nShared text for all pages") for i in range(3)]

        all_hashes: dict[str, set[str]] = {}
        for url, content in pages:
            for h in extract_paragraph_hashes(content):
                if h not in all_hashes:
                    all_hashes[h] = set()
                all_hashes[h].add(url)

        total = len(pages)
        assert total < MIN_DOMAIN_PAGES_FOR_DEDUP
        page_counts: dict[str, int] = {}

        filtered = filter_boilerplate_paragraphs(pages[0][1], page_counts)
        assert "Shared text for all pages" in filtered

    def test_realistic_crawler_output(self):
        """Simulates real crawl4ai output with single-newline-separated lines."""
        shared_cookie = 'By clicking "Allow All", you agree to cookies'
        shared_nav = "Skip to content"
        shared_footer = "Copyright 2024 Example Corp. All rights reserved."

        pages = []
        for i in range(30):
            content = "\n".join(
                [
                    shared_cookie,
                    shared_nav,
                    f"# Article Title for Page {i}",
                    f"This is unique body content for page number {i}.",
                    f"Another unique paragraph on page {i} with details.",
                    shared_footer,
                ]
            )
            pages.append((f"https://example.com/page{i}", content))

        all_hashes: dict[str, set[str]] = {}
        for url, content in pages:
            for h in extract_paragraph_hashes(content):
                if h not in all_hashes:
                    all_hashes[h] = set()
                all_hashes[h].add(url)

        page_counts = {h: len(urls) for h, urls in all_hashes.items()}

        assert page_counts[paragraph_hash(shared_cookie)] == 30
        assert page_counts[paragraph_hash(shared_footer)] == 30

        filtered = filter_boilerplate_paragraphs(pages[5][1], page_counts)
        assert "Allow All" not in filtered
        assert "Copyright 2024" not in filtered
        assert "Article Title for Page 5" in filtered
        assert "unique body content for page number 5" in filtered

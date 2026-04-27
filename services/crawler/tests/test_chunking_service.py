from app.services.chunking_service import (
    CHUNK_OVERLAP,
    CHUNK_SIZE,
    MIN_CHUNK_LENGTH,
    ContentChunk,
    chunk_content,
)


class TestChunkContentEmptyInput:
    def test_empty_string(self):
        assert chunk_content("") == []

    def test_none_like_empty(self):
        assert chunk_content("") == []

    def test_whitespace_only(self):
        assert chunk_content("   \n\n  \t  ") == []

    def test_newlines_only(self):
        assert chunk_content("\n\n\n") == []


class TestChunkContentSingleChunk:
    def test_short_content_returns_one_chunk(self):
        text = "Hello world, this is a test of the chunking service module that needs to be long enough to pass the minimum chunk length filter."
        result = chunk_content(text)
        assert len(result) == 1
        assert result[0].content == text
        assert result[0].index == 0

    def test_returns_content_chunk_dataclass(self):
        text = "Hello world, this is a test of the chunking service module re-exported via crawler."
        result = chunk_content(text)
        assert isinstance(result[0], ContentChunk)


# Title / URL injection used to live inside chunk_content() but moved to
# build_metadata_prefix() applied at embed time in indexing_service. Behavior
# for that helper is covered by tale_knowledge's own test suite; the crawler
# path is covered by test_indexing_service.
class TestBuildMetadataPrefixReExport:
    def test_importable(self):
        from app.services.chunking_service import build_metadata_prefix

        assert build_metadata_prefix("Title", "https://example.com") == ("Title\n\nhttps://example.com\n\n")


class TestChunkContentMultipleParagraphs:
    def test_two_paragraphs_within_limit_stay_in_one_chunk(self):
        p1 = "First paragraph with enough content to be meaningful here."
        p2 = "Second paragraph also with enough content to pass filters."
        content = f"{p1}\n\n{p2}"
        result = chunk_content(content, chunk_size=500)
        assert len(result) == 1
        assert p1 in result[0].content
        assert p2 in result[0].content

    def test_paragraphs_exceeding_limit_split_into_multiple_chunks(self):
        p1 = "A" * 100
        p2 = "B" * 100
        p3 = "C" * 100
        content = f"{p1}\n\n{p2}\n\n{p3}"
        result = chunk_content(content, chunk_size=150, chunk_overlap=20)
        assert len(result) > 1

    def test_paragraph_boundaries_preserved(self):
        p1 = "First paragraph with enough content to pass the minimum length."
        p2 = "Second paragraph also with enough content to pass the filter."
        content = f"{p1}\n\n{p2}"
        result = chunk_content(content, chunk_size=500)
        assert "\n\n" in result[0].content


class TestChunkContentOverlap:
    def test_multiple_chunks_produced_with_overlap(self):
        p1 = "A" * 150
        p2 = "B" * 150
        result = chunk_content(f"{p1}\n\n{p2}", chunk_size=200, chunk_overlap=50)
        assert len(result) >= 2

    def test_overlap_produces_shared_content(self):
        sentences = [f"Sentence number {i} with some extra words to fill." for i in range(20)]
        content = " ".join(sentences)
        result = chunk_content(content, chunk_size=200, chunk_overlap=50)
        assert len(result) >= 2
        # With overlap, adjacent chunks should share some content
        for i in range(len(result) - 1):
            combined_adjacent = result[i].content + result[i + 1].content
            assert len(combined_adjacent) > len(result[i].content)


class TestChunkContentLargeParagraphSentenceSplitting:
    def test_large_paragraph_splits_into_multiple(self):
        sentences = [f"This is sentence number {i}." for i in range(50)]
        large_para = " ".join(sentences)
        result = chunk_content(large_para, chunk_size=200, chunk_overlap=30)
        assert len(result) > 1

    def test_sentences_distributed_across_chunks(self):
        sentences = [f"This is a fairly long sentence number {i} here." for i in range(30)]
        large_para = " ".join(sentences)
        result = chunk_content(large_para, chunk_size=300, chunk_overlap=20)
        combined = " ".join(c.content for c in result)
        for s in sentences:
            assert s in combined


class TestChunkContentHardSplit:
    def test_very_long_text_gets_split(self):
        long_text = "A" * 5000
        result = chunk_content(long_text, chunk_size=500, chunk_overlap=50)
        assert len(result) > 1

    def test_hard_split_pieces_cover_original(self):
        long_text = "B" * 3000
        result = chunk_content(long_text, chunk_size=500, chunk_overlap=50)
        combined = "".join(c.content for c in result)
        assert "B" * 500 in combined


class TestChunkContentMinChunkLength:
    """min_chunk_length no longer filters chunks — doing so would break the
    tiling invariant `"".join(core_content) == content`. The parameter is
    preserved for backward compatibility and treated as a no-op."""

    def test_tiny_content_produces_one_chunk(self):
        # Pre-refactor this returned []; now it tiles the input fully.
        assert len(chunk_content("Hi.")) == 1

    def test_content_at_default_min_length_kept(self):
        assert len(chunk_content("A" * MIN_CHUNK_LENGTH)) == 1

    def test_content_below_default_min_length_still_returned(self):
        assert len(chunk_content("A" * (MIN_CHUNK_LENGTH - 1))) == 1

    def test_custom_min_chunk_length_is_ignored(self):
        # Param accepted but no longer acts as a filter.
        assert len(chunk_content("Short text.", min_chunk_length=500)) == 1


class TestChunkContentCustomParams:
    def test_custom_chunk_size(self):
        content = "Word " * 200
        result_small = chunk_content(content, chunk_size=200, chunk_overlap=10)
        result_large = chunk_content(content, chunk_size=2000, chunk_overlap=10)
        assert len(result_small) > len(result_large)

    def test_defaults_match_constants(self):
        assert CHUNK_SIZE == 2048
        assert CHUNK_OVERLAP == 200
        assert MIN_CHUNK_LENGTH == 10


class TestChunkContentIndexNumbering:
    def test_single_chunk_has_index_zero(self):
        text = "Hello world, this is a test of the chunking service module that needs to be long enough to pass the minimum chunk length filter."
        result = chunk_content(text)
        assert result[0].index == 0

    def test_multiple_chunks_have_sequential_indexes(self):
        paragraphs = [("P" * 100) for _ in range(10)]
        content = "\n\n".join(paragraphs)
        result = chunk_content(content, chunk_size=150, chunk_overlap=20)
        assert len(result) > 1
        for i, chunk in enumerate(result):
            assert chunk.index == i

    def test_indexes_are_contiguous(self):
        long_text = "X" * 3000
        result = chunk_content(long_text, chunk_size=300, chunk_overlap=30)
        indexes = [c.index for c in result]
        assert indexes == list(range(len(result)))


class TestMarkdownAwareChunking:
    def test_splits_at_header_boundaries(self):
        content = "## Section One\n\n" + "A" * 300 + "\n\n## Section Two\n\n" + "B" * 300
        result = chunk_content(content, chunk_size=400, chunk_overlap=0)
        assert len(result) >= 2
        assert "Section One" in result[0].content
        assert "Section Two" in result[-1].content

    def test_header_content_preserved_in_chunks(self):
        content = (
            "# Main Title\n\nSome introduction text that is long enough."
            "\n\n## Details\n\nMore details here that pass the filter."
        )
        result = chunk_content(content, chunk_size=2048)
        combined = "\n".join(c.content for c in result)
        assert "Main Title" in combined
        assert "Details" in combined

    def test_code_block_kept_intact(self):
        code = "```python\ndef hello():\n    print('world')\n    return 42\n```"
        content = f"Some intro text here.\n\n{code}\n\nSome outro text here."
        result = chunk_content(content, chunk_size=2048)
        combined = "\n".join(c.content for c in result)
        assert "def hello():" in combined
        assert "return 42" in combined

    def test_table_kept_intact(self):
        table = "| Col A | Col B |\n| --- | --- |\n| val1 | val2 |\n| val3 | val4 |"
        content = f"Some intro text here.\n\n{table}\n\nSome outro text here."
        result = chunk_content(content, chunk_size=2048)
        combined = "\n".join(c.content for c in result)
        assert "val1" in combined
        assert "val4" in combined

    def test_nested_headers_produce_chunks(self):
        content = (
            "# Top Level\n\nIntro text here with enough content to pass the minimum length filter.\n\n"
            "## Sub Section\n\nSub text here with additional words to ensure it is long enough.\n\n"
            "### Deep Section\n\nDeep text here with more words to reach the required minimum length."
        )
        result = chunk_content(content, chunk_size=2048)
        combined = "\n".join(c.content for c in result)
        assert "Top Level" in combined
        assert "Sub Section" in combined
        assert "Deep Section" in combined

    def test_long_section_gets_sub_split(self):
        long_body = " ".join([f"This is sentence number {i} in a very long section." for i in range(50)])
        content = f"## Long Section\n\n{long_body}"
        result = chunk_content(content, chunk_size=300, chunk_overlap=30)
        assert len(result) > 1

    def test_short_sections_merged_into_one_chunk(self):
        content = (
            "## Section A\n\nThis section has enough text to contribute to the merged chunk.\n\n"
            "## Section B\n\nAnother section with sufficient content for the minimum length.\n\n"
            "## Section C\n\nYet another section that adds words to reach the required threshold."
        )
        result = chunk_content(content, chunk_size=2048)
        assert len(result) == 1

    def test_realistic_page(self):
        content = (
            "# WiseKey Security Solutions\n\n"
            "WiseKey provides cybersecurity solutions for IoT and digital identity.\n\n"
            "## Products\n\n"
            "Our product line includes secure semiconductors and PKI services.\n\n"
            "### WiseKey IoT\n\n"
            "The IoT platform secures connected devices with certificate-based auth.\n\n"
            "### WiseKey PKI\n\n"
            "Public Key Infrastructure for enterprise identity management.\n\n"
            "## Partners\n\n"
            "We work with leading technology companies worldwide.\n\n"
            "## Contact\n\n"
            "Visit us at wisekey.com for more information."
        )
        result = chunk_content(content)
        assert len(result) >= 1
        combined = "\n".join(c.content for c in result)
        assert "WiseKey" in combined
        assert "IoT" in combined
        assert "PKI" in combined
        assert "Partners" in combined

    def test_all_content_preserved(self):
        sections = [f"## Section {i}\n\nContent for section {i} with enough words." for i in range(5)]
        content = "\n\n".join(sections)
        result = chunk_content(content, chunk_size=2048)
        combined = " ".join(c.content for c in result)
        for i in range(5):
            assert f"Section {i}" in combined
            assert f"Content for section {i}" in combined

"""Tests for markdown-aware content chunking."""

from tale_knowledge.chunking.splitter import (
    CHUNK_OVERLAP,
    CHUNK_SIZE,
    MIN_CHUNK_LENGTH,
    ContentChunk,
    build_metadata_prefix,
    chunk_content,
)


class TestChunkContent:
    def test_empty_content(self):
        assert chunk_content("") == []
        assert chunk_content("   ") == []

    def test_none_content(self):
        assert chunk_content(None) == []

    def test_short_content(self):
        text = "Hello world, this is a test of chunking." + " extra" * 10
        chunks = chunk_content(text)
        assert len(chunks) == 1
        assert chunks[0].content == text
        assert chunks[0].index == 0

    def test_chunk_indexes_sequential(self):
        text = "# Section\n\n" + ("word " * 500 + "\n\n") * 5
        chunks = chunk_content(text)
        for i, chunk in enumerate(chunks):
            assert chunk.index == i

    def test_returns_content_chunks(self):
        text = "Hello world, this is a test." + " more" * 20
        chunks = chunk_content(text)
        assert all(isinstance(c, ContentChunk) for c in chunks)

    def test_tiny_content_still_produces_chunk(self):
        # min_chunk_length no longer gates tiling — a 2-char input still
        # round-trips, otherwise "".join(core) != content.
        chunks = chunk_content("Hi")
        assert len(chunks) == 1
        assert chunks[0].core_content == "Hi"

    def test_short_valid_content_indexed(self):
        text = "2025年我们的销售额度是1000万"
        chunks = chunk_content(text)
        assert len(chunks) == 1
        assert chunks[0].content == text
        assert chunks[0].index == 0

    def test_custom_chunk_size(self):
        text = "word " * 1000
        small_chunks = chunk_content(text, chunk_size=200, chunk_overlap=20)
        large_chunks = chunk_content(text, chunk_size=2000, chunk_overlap=20)
        assert len(small_chunks) > len(large_chunks)

    def test_default_values(self):
        assert CHUNK_SIZE == 2048
        assert CHUNK_OVERLAP == 200
        assert MIN_CHUNK_LENGTH == 10

    def test_long_content_multiple_chunks(self):
        text = "# Document Title\n\n" + ("This is a paragraph of text. " * 50 + "\n\n") * 10
        chunks = chunk_content(text)
        assert len(chunks) > 1


class TestBuildMetadataPrefix:
    def test_title_and_url(self):
        prefix = build_metadata_prefix("My Page", "https://example.com/page")
        assert prefix == "My Page\n\nhttps://example.com/page\n\n"

    def test_title_only(self):
        assert build_metadata_prefix("Title", None) == "Title\n\n"

    def test_url_only(self):
        assert build_metadata_prefix(None, "https://example.com") == "https://example.com\n\n"

    def test_none_both(self):
        assert build_metadata_prefix(None, None) == ""

    def test_blank_strings(self):
        assert build_metadata_prefix("   ", "") == ""

    def test_strips_title_and_url(self):
        assert build_metadata_prefix("  Title  ", "  https://x.com  ") == "Title\n\nhttps://x.com\n\n"

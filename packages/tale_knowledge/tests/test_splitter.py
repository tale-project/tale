"""Tests for markdown-aware content chunking."""

from tale_knowledge.chunking.splitter import (
    CHUNK_OVERLAP,
    CHUNK_SIZE,
    MIN_CHUNK_LENGTH,
    ContentChunk,
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
        assert chunks[0].content == text.strip()
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

    def test_with_title_prefix(self):
        text = "Some content that is long enough to pass minimum." + " extra" * 10
        chunks = chunk_content(text, title="My Page Title")
        assert chunks[0].content.startswith("My Page Title")

    def test_with_url_prefix(self):
        text = "Some content that is long enough to pass minimum." + " extra" * 10
        chunks = chunk_content(text, url="https://example.com/page")
        assert "https://example.com/page" in chunks[0].content

    def test_with_title_and_url(self):
        text = "Some content that is long enough to pass minimum." + " extra" * 10
        chunks = chunk_content(text, title="Title", url="https://example.com")
        assert chunks[0].content.startswith("Title")
        assert "https://example.com" in chunks[0].content

    def test_min_chunk_length_filter(self):
        text = "Hi"  # Shorter than MIN_CHUNK_LENGTH
        chunks = chunk_content(text)
        assert chunks == []

    def test_custom_chunk_size(self):
        text = "word " * 1000
        small_chunks = chunk_content(text, chunk_size=200, chunk_overlap=20)
        large_chunks = chunk_content(text, chunk_size=2000, chunk_overlap=20)
        assert len(small_chunks) > len(large_chunks)

    def test_default_values(self):
        assert CHUNK_SIZE == 2048
        assert CHUNK_OVERLAP == 200
        assert MIN_CHUNK_LENGTH == 50

    def test_long_content_multiple_chunks(self):
        # Generate content that's definitely larger than one chunk
        text = (
            "# Document Title\n\n"
            + ("This is a paragraph of text. " * 50 + "\n\n") * 10
        )
        chunks = chunk_content(text)
        assert len(chunks) > 1

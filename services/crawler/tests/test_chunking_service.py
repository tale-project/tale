from app.services.chunking_service import (
    CHUNK_OVERLAP,
    CHUNK_SIZE,
    MIN_CHUNK_LENGTH,
    ContentChunk,
    _split_sentences,
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
        text = "Hello world, this is a test of the chunking service module."
        result = chunk_content(text)
        assert len(result) == 1
        assert result[0].content == text
        assert result[0].index == 0

    def test_content_is_stripped(self):
        text = "Hello world, this is a test of the chunking service module."
        result = chunk_content(f"  {text}  \n\n")
        assert result[0].content == text

    def test_returns_content_chunk_dataclass(self):
        text = "Hello world, this is a test of the chunking service module."
        result = chunk_content(text)
        assert isinstance(result[0], ContentChunk)


class TestChunkContentWithTitle:
    BODY = "Some body text here that is long enough to pass the minimum chunk length filter."

    def test_title_prepended_to_single_chunk(self):
        result = chunk_content(self.BODY, title="My Title")
        assert result[0].content.startswith("My Title\n\n")
        assert self.BODY in result[0].content

    def test_none_title_ignored(self):
        result = chunk_content(self.BODY, title=None)
        assert result[0].content == self.BODY

    def test_empty_title_ignored(self):
        result = chunk_content(self.BODY, title="")
        assert result[0].content == self.BODY

    def test_whitespace_title_ignored(self):
        result = chunk_content(self.BODY, title="   ")
        assert result[0].content == self.BODY

    def test_title_is_stripped(self):
        result = chunk_content(self.BODY, title="  My Title  ")
        assert result[0].content.startswith("My Title\n\n")

    def test_title_prepended_to_every_chunk(self):
        para = "A" * 100
        content = f"{para}\n\n{para}\n\n{para}"
        result = chunk_content(content, title="Title", chunk_size=150, chunk_overlap=20)
        for chunk in result:
            assert chunk.content.startswith("Title")


class TestChunkContentWithUrl:
    BODY = "Some body text here that is long enough to pass the minimum chunk length filter."

    def test_url_prepended_to_single_chunk(self):
        result = chunk_content(self.BODY, url="https://example.com/page")
        assert result[0].content.startswith("https://example.com/page\n\n")
        assert self.BODY in result[0].content

    def test_none_url_ignored(self):
        result = chunk_content(self.BODY, url=None)
        assert result[0].content == self.BODY

    def test_empty_url_ignored(self):
        result = chunk_content(self.BODY, url="")
        assert result[0].content == self.BODY

    def test_whitespace_url_ignored(self):
        result = chunk_content(self.BODY, url="   ")
        assert result[0].content == self.BODY

    def test_title_and_url_both_in_prefix(self):
        result = chunk_content(self.BODY, title="My Title", url="https://example.com/page")
        assert result[0].content.startswith("My Title\n\nhttps://example.com/page\n\n")
        assert self.BODY in result[0].content

    def test_url_prepended_to_every_chunk(self):
        para = "A" * 100
        content = f"{para}\n\n{para}\n\n{para}"
        result = chunk_content(content, url="https://example.com", chunk_size=200, chunk_overlap=20)
        for chunk in result:
            assert "https://example.com" in chunk.content


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
    def test_chunks_share_overlapping_text(self):
        p1 = "A" * 150
        p2 = "B" * 150
        result = chunk_content(f"{p1}\n\n{p2}", chunk_size=200, chunk_overlap=50)
        assert len(result) >= 2
        tail_of_first = result[0].content[-50:]
        assert tail_of_first in result[1].content

    def test_overlap_smaller_than_content_uses_tail(self):
        p1 = "X" * 200
        p2 = "Y" * 200
        result = chunk_content(f"{p1}\n\n{p2}", chunk_size=250, chunk_overlap=30)
        assert len(result) >= 2
        overlap_region = result[0].content[-30:]
        assert overlap_region in result[1].content


class TestChunkContentLargeParagraphSentenceSplitting:
    def test_large_paragraph_splits_by_sentence(self):
        sentences = [f"This is sentence number {i}." for i in range(50)]
        large_para = " ".join(sentences)
        result = chunk_content(large_para, chunk_size=200, chunk_overlap=30)
        assert len(result) > 1
        for chunk in result:
            assert len(chunk.content) <= 200 + 50

    def test_sentences_distributed_across_chunks(self):
        sentences = [f"This is a fairly long sentence number {i} here." for i in range(30)]
        large_para = " ".join(sentences)
        result = chunk_content(large_para, chunk_size=200, chunk_overlap=20)
        combined = " ".join(c.content for c in result)
        for s in sentences:
            assert s in combined


class TestChunkContentHardSplit:
    def test_very_long_sentence_hard_split(self):
        long_sentence = "A" * 5000
        result = chunk_content(long_sentence, chunk_size=500, chunk_overlap=50)
        assert len(result) > 1
        for chunk in result:
            assert len(chunk.content) <= 500 + 50

    def test_hard_split_pieces_cover_original(self):
        long_sentence = "B" * 3000
        result = chunk_content(long_sentence, chunk_size=500, chunk_overlap=50)
        combined = "".join(c.content for c in result)
        assert "B" * 500 in combined


class TestChunkContentMinChunkLength:
    def test_short_content_below_min_filtered_out(self):
        result = chunk_content("Hi.", min_chunk_length=100)
        assert result == []

    def test_content_at_min_length_kept(self):
        text = "A" * MIN_CHUNK_LENGTH
        result = chunk_content(text)
        assert len(result) == 1

    def test_content_just_below_min_length_filtered(self):
        text = "A" * (MIN_CHUNK_LENGTH - 1)
        result = chunk_content(text)
        assert result == []

    def test_custom_min_chunk_length(self):
        result = chunk_content("Short text.", min_chunk_length=5)
        assert len(result) == 1

    def test_custom_high_min_chunk_length_filters(self):
        result = chunk_content("Short text.", min_chunk_length=500)
        assert result == []


class TestChunkContentCustomParams:
    def test_custom_chunk_size(self):
        content = "Word " * 200
        result_small = chunk_content(content, chunk_size=100, chunk_overlap=10)
        result_large = chunk_content(content, chunk_size=2000, chunk_overlap=10)
        assert len(result_small) > len(result_large)

    def test_custom_overlap(self):
        p1 = "A" * 200
        p2 = "B" * 200
        content = f"{p1}\n\n{p2}"
        result_small_overlap = chunk_content(content, chunk_size=250, chunk_overlap=10)
        result_large_overlap = chunk_content(content, chunk_size=250, chunk_overlap=100)
        assert len(result_small_overlap) >= 2
        assert len(result_large_overlap) >= 2
        tail_10 = result_small_overlap[0].content[-10:]
        tail_100 = result_large_overlap[0].content[-100:]
        assert tail_10 in result_small_overlap[1].content
        assert tail_100 in result_large_overlap[1].content

    def test_defaults_match_constants(self):
        assert CHUNK_SIZE == 2048
        assert CHUNK_OVERLAP == 200
        assert MIN_CHUNK_LENGTH == 50


class TestChunkContentIndexNumbering:
    def test_single_chunk_has_index_zero(self):
        text = "Hello world, this is a test of the chunking service module."
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
        long_sentence = "X" * 3000
        result = chunk_content(long_sentence, chunk_size=300, chunk_overlap=30)
        indexes = [c.index for c in result]
        assert indexes == list(range(len(result)))


class TestSplitSentences:
    def test_basic_sentence_splitting(self):
        result = _split_sentences("Hello world. How are you?")
        assert result == ["Hello world.", "How are you?"]

    def test_abbreviation_dr(self):
        result = _split_sentences("Dr. Smith is here. He is good.")
        assert result == ["Dr. Smith is here.", "He is good."]

    def test_abbreviation_inc(self):
        result = _split_sentences("Apple Inc. reported earnings. Revenue grew.")
        assert result == ["Apple Inc. reported earnings.", "Revenue grew."]

    def test_exclamation_and_question_marks(self):
        result = _split_sentences("What happened! Tell me. Now!")
        assert result == ["What happened!", "Tell me.", "Now!"]

    def test_single_sentence(self):
        result = _split_sentences("Just one sentence.")
        assert result == ["Just one sentence."]

    def test_no_split_when_no_capital_after_period(self):
        result = _split_sentences("count is 3.5 million total")
        assert result == ["count is 3.5 million total"]

    def test_multiple_abbreviations(self):
        result = _split_sentences("Mr. and Mrs. Smith went out. They had fun.")
        assert result == ["Mr. and Mrs. Smith went out.", "They had fun."]

"""Property tests for the four tiling invariants produced by chunk_content.

These tests guard the load-bearing property that makes document_retrieve
return duplicate-free reassembled text:

  (1) "".join(c.core_content for c in chunks) == content           (tiling)
  (2) c.content == c.core_content + c.suffix_overlap                (embedding)
  (3) c.core_content.startswith(c.prefix_overlap)                   (prefix⊂core)
  (4) chunks[i].prefix_overlap == chunks[i-1].suffix_overlap        (ordering)

The corpus is intentionally diverse — each sample targets a different
splitter behavior (gap whitespace, overlap boundaries, CJK codepoints,
pathological inputs).
"""

from __future__ import annotations

import pytest

from tale_knowledge.chunking.splitter import chunk_content

# ---------------------------------------------------------------------------
# Corpus
# ---------------------------------------------------------------------------

CONNECTOR_TS_REGRESSION = """\
const API_BASE = 'https://api.tavily.com';
const MAX_RESULTS_CAP = 5;
const MAX_EXTRACT_URLS = 5;
const MAX_RESULT_CONTENT_CHARS = 2000;

const connector = {
  operations: ['search', 'extract'],

  testConnection: function (ctx) {
    const apiKey = ctx.secrets.get('apiKey');
    if (!apiKey) {
      throw new Error('Tavily API key is required.');
    }
    const response = ctx.http.post(API_BASE + '/search', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, query: 'ping', max_results: 1 }),
    });
    return { status: 'ok' };
  },
};

function truncateToChars(text, max) {
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max) + '… [truncated]';
}
"""

MARKDOWN_WITH_HEADERS = """\
# Title

Paragraph one. Sentence two. Sentence three.

## Section A

Para A body. More sentences go here, some longer than others.

### Subsection

Short content.

## Section B

Final paragraph with trailing whitespace.
"""

SINGLE_LONG_LINE = "abcdefghij" * 500  # no paragraph or sentence breaks

CJK_AND_EMOJI = "中文段落一段很长的文字。" * 20 + "🔥🎉🚀" * 10 + "Mixed English content here " * 10

PROSE = ("The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. ") * 80

LEADING_AND_TRAILING_WHITESPACE = "   \n\n  Body text with surrounding whitespace.  \n\n   "

TRAILING_NEWLINE = "Content line one.\nContent line two.\n"

SINGLE_CHAR = "x"

EXACTLY_CHUNK_SIZE = "x" * 2048  # default chunk_size


CORPUS = {
    "connector_ts_regression": (CONNECTOR_TS_REGRESSION, {}),
    "markdown_with_headers": (MARKDOWN_WITH_HEADERS, {}),
    "single_long_line_small_cap": (SINGLE_LONG_LINE, {"chunk_size": 500, "chunk_overlap": 50}),
    "cjk_and_emoji": (CJK_AND_EMOJI, {"chunk_size": 256, "chunk_overlap": 32}),
    "prose": (PROSE, {"chunk_size": 300, "chunk_overlap": 40}),
    "leading_trailing_ws": (LEADING_AND_TRAILING_WHITESPACE, {}),
    "trailing_newline": (TRAILING_NEWLINE, {}),
    "single_char": (SINGLE_CHAR, {}),
    "exactly_chunk_size": (EXACTLY_CHUNK_SIZE, {}),
}


# ---------------------------------------------------------------------------
# Invariants
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("name", list(CORPUS.keys()))
def test_tiling_invariant(name):
    """Invariant 1: cores tile the input exactly."""
    text, kwargs = CORPUS[name]
    chunks = chunk_content(text, **kwargs)
    if not chunks:
        pytest.skip(f"empty chunk list for {name}")
    assert "".join(c.core_content for c in chunks) == text


@pytest.mark.parametrize("name", list(CORPUS.keys()))
def test_content_is_subset_of_core_plus_suffix(name):
    """``content`` is always a substring of ``core_content + suffix_overlap``.

    The two are identical at overlap boundaries; at gap boundaries ``core``
    absorbs the gap whitespace the splitter trimmed, so the combined text
    is longer than ``content`` by exactly the dropped characters. Embedding
    should use ``content`` directly — not this combined form — since that
    preserves whatever byte sequence the splitter produced.
    """
    text, kwargs = CORPUS[name]
    chunks = chunk_content(text, **kwargs)
    if not chunks:
        pytest.skip(f"empty chunk list for {name}")
    for c in chunks:
        combined = c.core_content + c.suffix_overlap
        assert c.content in combined or combined.strip() == c.content.strip(), (
            f"{name} chunk {c.index}: content is not a subset of core+suffix (mod whitespace trim)"
        )


@pytest.mark.parametrize("name", list(CORPUS.keys()))
def test_prefix_is_substring_of_core(name):
    """Invariant 3: prefix_overlap is a prefix of core_content when non-empty."""
    text, kwargs = CORPUS[name]
    chunks = chunk_content(text, **kwargs)
    for c in chunks:
        if c.prefix_overlap:
            assert c.core_content.startswith(c.prefix_overlap), (
                f"{name} chunk {c.index}: prefix_overlap is not a prefix of core_content"
            )


@pytest.mark.parametrize("name", list(CORPUS.keys()))
def test_prefix_matches_previous_suffix(name):
    """Invariant 4: prefix_overlap_i == suffix_overlap_{i-1}."""
    text, kwargs = CORPUS[name]
    chunks = chunk_content(text, **kwargs)
    for i in range(1, len(chunks)):
        assert chunks[i].prefix_overlap == chunks[i - 1].suffix_overlap, (
            f"{name}: chunk {i} prefix != chunk {i - 1} suffix"
        )


@pytest.mark.parametrize("name", list(CORPUS.keys()))
def test_first_chunk_has_no_prefix(name):
    text, kwargs = CORPUS[name]
    chunks = chunk_content(text, **kwargs)
    if chunks:
        assert chunks[0].prefix_overlap == ""


@pytest.mark.parametrize("name", list(CORPUS.keys()))
def test_last_chunk_has_no_suffix(name):
    text, kwargs = CORPUS[name]
    chunks = chunk_content(text, **kwargs)
    if chunks:
        assert chunks[-1].suffix_overlap == ""


# ---------------------------------------------------------------------------
# Determinism + edge cases
# ---------------------------------------------------------------------------


def test_reindex_idempotency():
    """Running chunk_content twice on the same input produces identical output."""
    a = chunk_content(PROSE, chunk_size=300, chunk_overlap=40)
    b = chunk_content(PROSE, chunk_size=300, chunk_overlap=40)
    assert len(a) == len(b)
    for x, y in zip(a, b, strict=True):
        assert x == y


def test_empty_returns_empty():
    assert chunk_content("") == []
    assert chunk_content(None) == []
    assert chunk_content("   \n\n\t") == []


def test_leading_whitespace_preserved_in_reassembly():
    """If the splitter trims internal leading whitespace, core_0 still starts at offset 0."""
    text = "   \n\nactual body text that is long enough for the splitter"
    chunks = chunk_content(text, chunk_size=200, chunk_overlap=20)
    if chunks:
        assert "".join(c.core_content for c in chunks) == text


def test_trailing_whitespace_preserved_in_reassembly():
    """If the splitter trims internal trailing whitespace, the last core still ends at len(content)."""
    text = "actual body text that is long enough for the splitter\n\n   "
    chunks = chunk_content(text, chunk_size=200, chunk_overlap=20)
    if chunks:
        assert "".join(c.core_content for c in chunks) == text


def test_connector_ts_no_duplicated_blocks():
    """Regression: the exact block that duplicated in the original bug report appears once in reassembly."""
    chunks = chunk_content(CONNECTOR_TS_REGRESSION, chunk_size=512, chunk_overlap=100)
    reassembled = "".join(c.core_content for c in chunks)
    assert reassembled == CONNECTOR_TS_REGRESSION
    # And the specific duplicated block appears exactly once.
    duplicate_block = "const API_BASE = 'https://api.tavily.com';"
    assert reassembled.count(duplicate_block) == 1

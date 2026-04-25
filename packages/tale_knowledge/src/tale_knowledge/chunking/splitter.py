"""Markdown-aware content chunking for search indexing.

Uses semantic-text-splitter's MarkdownSplitter to split at structural
boundaries (headers, code blocks, tables, paragraphs, sentences) while
respecting a target chunk size.

Each returned chunk carries three derived text fields so downstream storage
can both (a) faithfully reconstruct the original document and (b) keep the
embedding text identical to the splitter's raw output:

- ``content``        — the splitter's raw chunk text. Use this as the
  embedding input; it matches ``core_content + suffix_overlap``.
- ``core_content``   — the chunk's "forward-owning" span of the original
  input. ``"".join(c.core_content for c in chunks) == content`` exactly,
  even when the splitter trims whitespace at gap boundaries or at the
  edges of the input. Reassembly ("document_retrieve") concatenates just
  these across chunks, which eliminates the overlap-duplication bug that
  ``"\\n\\n".join(chunk_content)`` exhibited.
- ``prefix_overlap`` — the portion of ``core_content`` that is also the
  tail of the previous chunk. Empty for chunk 0.
- ``suffix_overlap`` — the portion of the splitter's raw chunk text that
  overlaps with the next chunk's ``core_content``. Equal to the next
  chunk's ``prefix_overlap`` when non-empty. Empty for the last chunk.

Title / URL prefix injection was removed from this module: callers that
want to bias embedding or BM25 toward a page's metadata (e.g. the crawler)
should build that text at embed time via :func:`build_metadata_prefix` and
compose it with ``chunk.content`` before calling the embedding service,
leaving the stored ``chunk.content`` free of the prefix.
"""

from __future__ import annotations

from dataclasses import dataclass

from semantic_text_splitter import MarkdownSplitter

CHUNK_SIZE = 2048
CHUNK_OVERLAP = 200
MIN_CHUNK_LENGTH = 10


@dataclass
class ContentChunk:
    """One chunk produced by :func:`chunk_content`.

    Invariants (held by ``chunk_content``'s output; verified by the
    property tests in ``packages/tale_knowledge/tests/``):

    * **Tiling:** ``"".join(c.core_content for c in chunks) == <input>``.
      This is the load-bearing property that makes ``document_retrieve``
      reassembly duplicate-free.
    * ``prefix_overlap`` is a prefix-substring of ``core_content`` when non-empty.
    * ``chunks[i].prefix_overlap == chunks[i - 1].suffix_overlap`` when both non-empty.

    ``content`` is the splitter's raw chunk text and is what callers should
    pass to the embedding service. It is **not** required to equal
    ``core_content + suffix_overlap``: at gap boundaries (where the splitter
    dropped inter-chunk whitespace) ``core_content`` absorbs that gap, so
    ``core_content + suffix_overlap`` is longer than ``content`` by a few
    whitespace chars. The drift is cosine-trivial; embed ``content``
    directly and ignore the identity.

    The new fields default to empty strings so legacy callers and test
    fixtures that only set ``content`` / ``index`` continue to construct.
    """

    content: str
    index: int
    core_content: str = ""
    prefix_overlap: str = ""
    suffix_overlap: str = ""


def build_metadata_prefix(title: str | None, url: str | None) -> str:
    """Build a "title\\n\\nurl\\n\\n" prefix for embed-time bias.

    Public helper: previously applied inside the chunker, it now lives at
    the call site so stored chunk text stays metadata-free and the chunker
    invariants hold unconditionally.
    """
    parts: list[str] = []
    if title and title.strip():
        parts.append(title.strip())
    if url and url.strip():
        parts.append(url.strip())
    return "\n\n".join(parts) + "\n\n" if parts else ""


def chunk_content(
    content: str | None,
    chunk_size: int = CHUNK_SIZE,
    chunk_overlap: int = CHUNK_OVERLAP,
    min_chunk_length: int = MIN_CHUNK_LENGTH,
) -> list[ContentChunk]:
    """Split ``content`` into overlap-aware chunks.

    Returns an empty list for ``None`` / empty / whitespace-only input.
    ``min_chunk_length`` is currently unused for the tiling computation —
    filtering short chunks would break the tiling invariant
    ``"".join(core) == content``. The parameter is kept for backward
    compatibility and may be repurposed in the future.
    """
    if not content or not content.strip():
        return []

    effective_overlap = min(chunk_overlap, chunk_size // 2)
    splitter = MarkdownSplitter(chunk_size, overlap=effective_overlap)

    # Pass the raw content — NOT ``content.strip()`` — so offsets returned
    # by ``chunk_indices`` are indices into the exact input. Offsets are
    # Unicode code points (safe for Python str slicing with CJK / emoji /
    # combining characters on semantic-text-splitter 0.29+).
    pairs: list[tuple[int, str]] = list(splitter.chunk_indices(content))
    if not pairs:
        return []

    _ = min_chunk_length  # Intentionally unused: see docstring.

    n = len(pairs)
    chunks: list[ContentChunk] = []

    for i, (start, raw) in enumerate(pairs):
        end = start + len(raw)

        # Forward-owning span. Pin chunk 0 to offset 0 and the last chunk
        # to len(content) so any leading / trailing whitespace the splitter
        # trimmed internally is absorbed into the adjacent core and the
        # tiling invariant holds.
        core_start = 0 if i == 0 else start
        core_end = len(content) if i == n - 1 else pairs[i + 1][0]
        core = content[core_start:core_end]

        prefix_overlap = ""
        if i > 0:
            prev_end = pairs[i - 1][0] + len(pairs[i - 1][1])
            if prev_end > start:
                prefix_overlap = content[start : min(prev_end, core_end)]

        suffix_overlap = ""
        if i < n - 1:
            next_start = pairs[i + 1][0]
            if end > next_start:
                suffix_overlap = content[next_start:end]

        chunks.append(
            ContentChunk(
                content=raw,
                index=i,
                core_content=core,
                prefix_overlap=prefix_overlap,
                suffix_overlap=suffix_overlap,
            )
        )

    return chunks

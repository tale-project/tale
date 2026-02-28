"""Markdown-aware content chunking for search indexing.

Uses semantic-text-splitter's MarkdownSplitter to split at structural
boundaries (headers, code blocks, tables, paragraphs, sentences) while
respecting a target chunk size. Page title and URL are injected as
metadata prefix into every chunk.
"""

from dataclasses import dataclass

from semantic_text_splitter import MarkdownSplitter

CHUNK_SIZE = 2048
CHUNK_OVERLAP = 200
MIN_CHUNK_LENGTH = 50


@dataclass
class ContentChunk:
    content: str
    index: int


def _build_prefix(title: str | None, url: str | None) -> str:
    parts: list[str] = []
    if title and title.strip():
        parts.append(title.strip())
    if url and url.strip():
        parts.append(url.strip())
    return "\n\n".join(parts) + "\n\n" if parts else ""


def chunk_content(
    content: str,
    title: str | None = None,
    url: str | None = None,
    chunk_size: int = CHUNK_SIZE,
    chunk_overlap: int = CHUNK_OVERLAP,
    min_chunk_length: int = MIN_CHUNK_LENGTH,
) -> list[ContentChunk]:
    if not content or not content.strip():
        return []

    prefix = _build_prefix(title, url)
    effective_size = max(chunk_size - len(prefix), min_chunk_length)

    splitter = MarkdownSplitter(effective_size, overlap=chunk_overlap)
    raw_chunks = splitter.chunks(content.strip())

    chunks: list[ContentChunk] = []
    idx = 0
    for raw in raw_chunks:
        text = (prefix + raw).strip()
        if len(text) >= min_chunk_length:
            chunks.append(ContentChunk(content=text, index=idx))
            idx += 1

    return chunks

"""
Fixed-size content chunking for search indexing.

Splits text into overlapping chunks of ~512 tokens (~2048 chars),
splitting on paragraph/sentence boundaries where possible.
"""

import re
from dataclasses import dataclass

CHUNK_SIZE = 2048
CHUNK_OVERLAP = 200
MIN_CHUNK_LENGTH = 50


@dataclass
class ContentChunk:
    content: str
    index: int


def chunk_content(
    content: str,
    title: str | None = None,
    chunk_size: int = CHUNK_SIZE,
    chunk_overlap: int = CHUNK_OVERLAP,
    min_chunk_length: int = MIN_CHUNK_LENGTH,
) -> list[ContentChunk]:
    if not content or not content.strip():
        return []

    text = content.strip()
    prefix = f"{title.strip()}\n\n" if title and title.strip() else ""

    # Split into paragraphs first
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]

    chunks: list[ContentChunk] = []
    current = prefix
    idx = 0

    for para in paragraphs:
        # If adding this paragraph exceeds chunk_size, finalize current chunk
        if current and len(current) + len(para) + 2 > chunk_size:
            if len(current.strip()) >= min_chunk_length:
                chunks.append(ContentChunk(content=current.strip(), index=idx))
                idx += 1

            # Start new chunk with overlap from the end of current
            overlap_text = current[-chunk_overlap:] if len(current) > chunk_overlap else current
            current = prefix + overlap_text.lstrip()

        if len(para) > chunk_size:
            # Large paragraph: split by sentences
            sentences = _split_sentences(para)
            for sentence in sentences:
                if len(current) + len(sentence) + 1 > chunk_size:
                    if len(current.strip()) >= min_chunk_length:
                        chunks.append(ContentChunk(content=current.strip(), index=idx))
                        idx += 1
                    overlap_text = current[-chunk_overlap:] if len(current) > chunk_overlap else current
                    current = prefix + overlap_text.lstrip()

                if len(sentence) > chunk_size:
                    # Very long sentence: hard split
                    for start in range(0, len(sentence), chunk_size - chunk_overlap):
                        piece = sentence[start : start + chunk_size]
                        if len(piece.strip()) >= min_chunk_length:
                            chunks.append(ContentChunk(content=(prefix + piece).strip(), index=idx))
                            idx += 1
                    current = prefix
                else:
                    current = current + " " + sentence if current.strip() else prefix + sentence
        else:
            current = current + "\n\n" + para if current.strip() else prefix + para

    # Flush remaining
    if current and len(current.strip()) >= min_chunk_length:
        chunks.append(ContentChunk(content=current.strip(), index=idx))

    return chunks


_ABBREVIATIONS = frozenset(
    {
        "Mr",
        "Mrs",
        "Ms",
        "Dr",
        "Jr",
        "Sr",
        "Prof",
        "St",
        "vs",
        "etc",
        "approx",
        "Inc",
        "Ltd",
        "Corp",
        "Co",
        "Dept",
        "Univ",
        "Gen",
        "Gov",
        "Sgt",
        "Cpl",
        "Pvt",
        "Capt",
        "Lt",
        "Col",
        "No",
    }
)

_SENTENCE_SPLIT = re.compile(r'([.!?])\s+(?=[A-Z"])')


def _split_sentences(text: str) -> list[str]:
    parts = _SENTENCE_SPLIT.split(text)

    # _SENTENCE_SPLIT captures the punctuation as group(1), so the result
    # alternates: [text, punct, text, punct, text, ...]
    # Reassemble by gluing each punctuation back onto the preceding segment.
    raw: list[str] = []
    i = 0
    while i < len(parts):
        segment = parts[i]
        if i + 1 < len(parts) and parts[i + 1] in ".!?":
            segment += parts[i + 1]
            i += 2
        else:
            i += 1
        stripped = segment.strip()
        if stripped:
            raw.append(stripped)

    # Rejoin segments that were split after an abbreviation or single capital
    sentences: list[str] = []
    for seg in raw:
        if sentences and _is_abbreviation_ending(sentences[-1]):
            sentences[-1] += " " + seg
        else:
            sentences.append(seg)

    return sentences


def _is_abbreviation_ending(s: str) -> bool:
    if not s or s[-1] != ".":
        return False
    # Single capital letter (e.g. "U." in "U.S.")
    if len(s) >= 2 and s[-2].isupper():
        return True
    # Known abbreviation: find the last word before the trailing dot
    last_dot = s.rfind(".", 0, len(s) - 1)
    last_space = s.rfind(" ", 0, len(s) - 1)
    start = max(last_dot, last_space) + 1
    word = s[start:-1]
    return word in _ABBREVIATIONS

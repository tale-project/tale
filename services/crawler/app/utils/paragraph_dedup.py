"""Cross-page paragraph deduplication for boilerplate filtering.

Tracks paragraph fingerprints per page to identify content that appears
across many pages in a domain. Paragraphs exceeding a frequency threshold
are considered boilerplate and filtered before chunking.
"""

import hashlib
import unicodedata

BOILERPLATE_FREQUENCY_THRESHOLD = 0.5
MIN_DOMAIN_PAGES_FOR_DEDUP = 5
MIN_LINE_LENGTH = 10


def paragraph_hash(text: str) -> str:
    """MD5 hash of normalized, stripped paragraph text."""
    normalized = unicodedata.normalize("NFC", text.strip())
    return hashlib.md5(normalized.encode()).hexdigest()


def _is_hashable_line(line: str) -> bool:
    """Whether a line is long enough to be a meaningful fingerprint."""
    return len(line.strip()) >= MIN_LINE_LENGTH


def extract_paragraph_hashes(content: str) -> list[str]:
    """Extract unique line-level hashes from markdown content.

    Splits on single newlines for line-level granularity so that
    boilerplate lines (cookie banners, nav, footers) are individually
    fingerprinted even when the crawler emits single-newline-separated
    markdown. Lines shorter than MIN_LINE_LENGTH are skipped.
    Deduplicates within a page so repeated lines don't inflate
    cross-page frequency.
    """
    seen: set[str] = set()
    result: list[str] = []
    for line in content.strip().split("\n"):
        stripped = line.strip()
        if not stripped or not _is_hashable_line(stripped):
            continue
        h = paragraph_hash(stripped)
        if h not in seen:
            seen.add(h)
            result.append(h)
    return result


def filter_boilerplate_paragraphs(
    content: str,
    frequencies: dict[str, float],
    threshold: float = BOILERPLATE_FREQUENCY_THRESHOLD,
) -> str:
    """Remove lines exceeding the frequency threshold.

    Args:
        content: Raw markdown page content.
        frequencies: Mapping of paragraph_hash to fraction of pages (0.0-1.0).
        threshold: Lines appearing on more than this fraction are removed.

    Returns content with boilerplate lines removed. Lines shorter than
    MIN_LINE_LENGTH are always kept (not enough signal to fingerprint).
    If frequencies is empty (domain too small), returns content unchanged.
    """
    if not frequencies:
        return content

    lines = content.split("\n")
    kept = [
        line
        for line in lines
        if not _is_hashable_line(line) or frequencies.get(paragraph_hash(line.strip()), 0.0) <= threshold
    ]
    return "\n".join(kept)

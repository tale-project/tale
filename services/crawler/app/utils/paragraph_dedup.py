"""Cross-page paragraph deduplication for boilerplate filtering.

Tracks paragraph fingerprints per page to identify content that appears
across many pages in a domain. Paragraphs exceeding a frequency threshold
are considered boilerplate and filtered before chunking.
"""

import hashlib
import unicodedata

BOILERPLATE_FREQUENCY_THRESHOLD = 0.5
MIN_DOMAIN_PAGES_FOR_DEDUP = 5


def paragraph_hash(text: str) -> str:
    """MD5 hash of normalized, stripped paragraph text."""
    normalized = unicodedata.normalize("NFC", text.strip())
    return hashlib.md5(normalized.encode()).hexdigest()


def extract_paragraph_hashes(content: str) -> list[str]:
    """Extract unique paragraph hashes from markdown content.

    Splits on double-newline boundaries. Deduplicates within a page
    so repeated paragraphs don't inflate cross-page frequency.
    """
    seen: set[str] = set()
    result: list[str] = []
    for para in content.strip().split("\n\n"):
        if not para.strip():
            continue
        h = paragraph_hash(para)
        if h not in seen:
            seen.add(h)
            result.append(h)
    return result


def filter_boilerplate_paragraphs(
    content: str,
    frequencies: dict[str, float],
    threshold: float = BOILERPLATE_FREQUENCY_THRESHOLD,
) -> str:
    """Remove paragraphs exceeding the frequency threshold.

    Args:
        content: Raw markdown page content.
        frequencies: Mapping of paragraph_hash to fraction of pages (0.0-1.0).
        threshold: Paragraphs appearing on more than this fraction are removed.

    Returns content with boilerplate paragraphs removed. If frequencies is
    empty (domain too small), returns content unchanged.
    """
    if not frequencies:
        return content

    paragraphs = content.strip().split("\n\n")
    kept = [p for p in paragraphs if frequencies.get(paragraph_hash(p), 0.0) <= threshold]
    return "\n\n".join(kept)

"""Document comparison service using deterministic text diffing.

Provides paragraph-level text comparison with change block grouping,
text normalization, and divergence detection.
"""

from __future__ import annotations

import difflib
import re
from dataclasses import dataclass, field

CONTEXT_TRUNCATE_CHARS = 200
MERGE_GAP_THRESHOLD = 5
DIVERGENCE_THRESHOLD = 0.7
INLINE_DIFF_MAX_CHARS = 2000

_CLAUSE_REF_PATTERN = re.compile(
    r"(?:Section|Ziff\.|Ziffer|§§?|Art\.|Artikel|Abs\.|Absatz|Abschnitt|Klausel|Anhang)\s*"
    r"(\d+(?:\.\d+)*(?:\s*(?:bis|und|,|-)\s*\d+(?:\.\d+)*)*)"
    r"(?:\s*ff\.)?",
    re.IGNORECASE,
)


def compute_inline_diff(base: str, comparison: str) -> str | None:
    """Compute word-level inline diff between two paragraphs.

    Returns a merged string with [-deleted-] and {+added+} markers.
    Returns None if either text exceeds INLINE_DIFF_MAX_CHARS.
    """
    if len(base) > INLINE_DIFF_MAX_CHARS or len(comparison) > INLINE_DIFF_MAX_CHARS:
        return None

    base_words = base.split()
    comp_words = comparison.split()
    if not base_words and not comp_words:
        return None

    matcher = difflib.SequenceMatcher(None, base_words, comp_words, autojunk=False)

    parts: list[str] = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            parts.append(" ".join(base_words[i1:i2]))
        elif tag == "replace":
            parts.append("[-" + " ".join(base_words[i1:i2]) + "-]")
            parts.append("{+" + " ".join(comp_words[j1:j2]) + "+}")
        elif tag == "delete":
            parts.append("[-" + " ".join(base_words[i1:i2]) + "-]")
        elif tag == "insert":
            parts.append("{+" + " ".join(comp_words[j1:j2]) + "+}")
    return " ".join(parts)


def extract_clause_ref(text: str) -> str | None:
    """Extract the first clause/section reference from paragraph text."""
    match = _CLAUSE_REF_PATTERN.search(text)
    return match.group(0).strip() if match else None


@dataclass
class DiffItem:
    type: str  # "added" | "deleted" | "modified" | "context"
    base_content: str | None = None
    comparison_content: str | None = None
    content: str | None = None  # for "context" type
    inline_diff: str | None = None
    clause_ref: str | None = None
    base_page: int | None = None
    comparison_page: int | None = None

    def to_dict(self) -> dict:
        if self.type == "context":
            return {"type": "context", "content": self.content}
        result = {
            "type": self.type,
            "base_content": self.base_content,
            "comparison_content": self.comparison_content,
        }
        if self.inline_diff is not None:
            result["inline_diff"] = self.inline_diff
        if self.clause_ref is not None:
            result["clause_ref"] = self.clause_ref
        if self.base_page is not None:
            result["base_page"] = self.base_page
        if self.comparison_page is not None:
            result["comparison_page"] = self.comparison_page
        return result


@dataclass
class ChangeBlock:
    context_before: str | None = None
    items: list[DiffItem] = field(default_factory=list)
    context_after: str | None = None

    def to_dict(self) -> dict:
        return {
            "context_before": self.context_before,
            "items": [item.to_dict() for item in self.items],
            "context_after": self.context_after,
        }


@dataclass
class DiffStats:
    total_paragraphs_base: int = 0
    total_paragraphs_comparison: int = 0
    unchanged: int = 0
    modified: int = 0
    added: int = 0
    deleted: int = 0
    high_divergence: bool = False

    def to_dict(self) -> dict:
        return {
            "total_paragraphs_base": self.total_paragraphs_base,
            "total_paragraphs_comparison": self.total_paragraphs_comparison,
            "unchanged": self.unchanged,
            "modified": self.modified,
            "added": self.added,
            "deleted": self.deleted,
            "high_divergence": self.high_divergence,
        }


@dataclass
class DiffResult:
    change_blocks: list[ChangeBlock]
    stats: DiffStats
    truncated: bool = False

    def to_dict(self) -> dict:
        return {
            "change_blocks": [block.to_dict() for block in self.change_blocks],
            "stats": self.stats.to_dict(),
            "truncated": self.truncated,
        }


# Unicode normalization mappings
_QUOTE_MAP = str.maketrans(
    {
        "\u201c": '"',  # left double quotation mark
        "\u201d": '"',  # right double quotation mark
        "\u201e": '"',  # double low-9 quotation mark
        "\u2018": "'",  # left single quotation mark
        "\u2019": "'",  # right single quotation mark
        "\u201a": "'",  # single low-9 quotation mark
        "\u00ab": '"',  # left-pointing double angle quotation mark
        "\u00bb": '"',  # right-pointing double angle quotation mark
    }
)

_DASH_MAP = str.maketrans(
    {
        "\u2014": "--",  # em dash
        "\u2013": "--",  # en dash
        "\u2012": "-",  # figure dash
        "\u2015": "--",  # horizontal bar
    }
)

_IMAGE_PATTERN = re.compile(r"\[Image:[^\]]*\]")
_TABLE_PREFIX_PATTERN = re.compile(r"^\[Table\]\s*", re.MULTILINE)
_MULTI_SPACE = re.compile(r"[ \t]{2,}")


def normalize_text(text: str) -> str:
    """Normalize text for stable diffing.

    - Normalize Unicode quotes and dashes
    - Remove non-deterministic image placeholders
    - Strip [Table] prefixes (keep content)
    - Collapse multiple spaces
    - Strip trailing whitespace per line
    """
    text = text.translate(_QUOTE_MAP)
    text = text.translate(_DASH_MAP)
    text = _IMAGE_PATTERN.sub("", text)
    text = _TABLE_PREFIX_PATTERN.sub("", text)
    text = _MULTI_SPACE.sub(" ", text)
    lines = [line.rstrip() for line in text.splitlines()]
    return "\n".join(lines)


def split_paragraphs(text: str) -> list[str]:
    """Split text into paragraphs by double newlines, filtering empties."""
    raw = text.split("\n\n")
    return [p.strip() for p in raw if p.strip()]


def _truncate(text: str, max_chars: int = CONTEXT_TRUNCATE_CHARS) -> str:
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "..."


def _build_page_map(n_paragraphs: int, page_breaks: list[int]) -> list[int]:
    """Build a list mapping paragraph index to page number (1-based).

    page_breaks contains element position indices where explicit page breaks
    occur. Paragraphs before the first break are page 1, between first and
    second break are page 2, etc.
    """
    if not page_breaks:
        return [1] * n_paragraphs
    pages = []
    current_page = 1
    break_idx = 0
    for i in range(n_paragraphs):
        if break_idx < len(page_breaks) and i >= page_breaks[break_idx]:
            current_page += 1
            break_idx += 1
        pages.append(current_page)
    return pages


def compute_diff(
    base_text: str,
    comparison_text: str,
    *,
    max_changes: int = 500,
    base_page_breaks: list[int] | None = None,
    comp_page_breaks: list[int] | None = None,
) -> DiffResult:
    """Compute paragraph-level diff between two documents.

    Args:
        base_text: Full text of the base document.
        comparison_text: Full text of the comparison document.
        max_changes: Maximum number of change items to return.

    Returns:
        DiffResult with grouped change blocks and statistics.
    """
    base_normalized = normalize_text(base_text)
    comp_normalized = normalize_text(comparison_text)

    base_paras = split_paragraphs(base_normalized)
    comp_paras = split_paragraphs(comp_normalized)

    base_pages = _build_page_map(len(base_paras), base_page_breaks or [])
    comp_pages = _build_page_map(len(comp_paras), comp_page_breaks or [])
    has_pages = bool(base_page_breaks or comp_page_breaks)

    matcher = difflib.SequenceMatcher(None, base_paras, comp_paras, autojunk=False)
    opcodes = matcher.get_opcodes()

    stats = DiffStats(
        total_paragraphs_base=len(base_paras),
        total_paragraphs_comparison=len(comp_paras),
    )

    # Build a flat list of (opcode_type, items) segments
    segments: list[tuple[str, list[DiffItem] | list[str]]] = []

    for tag, i1, i2, j1, j2 in opcodes:
        if tag == "equal":
            equal_paras = base_paras[i1:i2]
            stats.unchanged += len(equal_paras)
            segments.append(("equal", equal_paras))
        elif tag == "replace":
            items: list[DiffItem] = []
            base_slice = base_paras[i1:i2]
            comp_slice = comp_paras[j1:j2]
            max_len = max(len(base_slice), len(comp_slice))
            for k in range(max_len):
                b = base_slice[k] if k < len(base_slice) else None
                c = comp_slice[k] if k < len(comp_slice) else None
                if b is not None and c is not None:
                    item = DiffItem(type="modified", base_content=b, comparison_content=c)
                    item.inline_diff = compute_inline_diff(b, c)
                    item.clause_ref = extract_clause_ref(c) or extract_clause_ref(b)
                    if has_pages:
                        item.base_page = base_pages[i1 + k] if i1 + k < len(base_pages) else None
                        item.comparison_page = comp_pages[j1 + k] if j1 + k < len(comp_pages) else None
                    items.append(item)
                    stats.modified += 1
                elif b is None:
                    item = DiffItem(type="added", comparison_content=c)
                    item.clause_ref = extract_clause_ref(c)
                    if has_pages:
                        item.comparison_page = comp_pages[j1 + k] if j1 + k < len(comp_pages) else None
                    items.append(item)
                    stats.added += 1
                else:
                    item = DiffItem(type="deleted", base_content=b)
                    item.clause_ref = extract_clause_ref(b)
                    if has_pages:
                        item.base_page = base_pages[i1 + k] if i1 + k < len(base_pages) else None
                    items.append(item)
                    stats.deleted += 1
            segments.append(("change", items))
        elif tag == "insert":
            items = []
            for j in range(j1, j2):
                item = DiffItem(type="added", comparison_content=comp_paras[j])
                item.clause_ref = extract_clause_ref(comp_paras[j])
                if has_pages:
                    item.comparison_page = comp_pages[j] if j < len(comp_pages) else None
                items.append(item)
            stats.added += j2 - j1
            segments.append(("change", items))
        elif tag == "delete":
            items = []
            for i in range(i1, i2):
                item = DiffItem(type="deleted", base_content=base_paras[i])
                item.clause_ref = extract_clause_ref(base_paras[i])
                if has_pages:
                    item.base_page = base_pages[i] if i < len(base_pages) else None
                items.append(item)
            stats.deleted += i2 - i1
            segments.append(("change", items))

    # Detect high divergence
    total_paras = max(len(base_paras), len(comp_paras), 1)
    changed = stats.modified + stats.added + stats.deleted
    stats.high_divergence = (changed / total_paras) > DIVERGENCE_THRESHOLD

    # Group change segments into blocks with hunk merging
    change_blocks, truncated = _group_into_blocks(segments, max_changes)

    return DiffResult(change_blocks=change_blocks, stats=stats, truncated=truncated)


def _group_into_blocks(
    segments: list[tuple[str, list]],
    max_changes: int,
) -> tuple[list[ChangeBlock], bool]:
    """Group change segments into blocks, merging close hunks.

    If two change segments are separated by <=MERGE_GAP_THRESHOLD equal
    paragraphs, they merge into one block with the equal paragraphs as
    inline context items. Otherwise, separate blocks with truncated
    context before/after.
    """
    # Find runs of change segments separated by small equal gaps
    blocks: list[ChangeBlock] = []
    current_block: ChangeBlock | None = None
    total_items = 0
    truncated = False

    # Track the last equal segment for context_before
    last_equal: list[str] | None = None

    for seg_type, seg_data in segments:
        if seg_type == "equal":
            equal_paras: list[str] = seg_data
            if current_block is not None:
                # We're in a block — decide: merge or close
                if len(equal_paras) <= MERGE_GAP_THRESHOLD:
                    # Merge: add equal paras as inline context
                    for p in equal_paras:
                        current_block.items.append(DiffItem(type="context", content=_truncate(p)))
                else:
                    # Close current block with context_after
                    current_block.context_after = _truncate(equal_paras[0])
                    blocks.append(current_block)
                    current_block = None
            last_equal = equal_paras
        else:
            change_items: list[DiffItem] = seg_data

            if total_items + len(change_items) > max_changes:
                remaining = max_changes - total_items
                if remaining > 0:
                    change_items = change_items[:remaining]
                    truncated = True
                else:
                    truncated = True
                    break

            if current_block is None:
                # Start new block with context_before from last equal
                ctx_before = None
                if last_equal:
                    ctx_before = _truncate(last_equal[-1])
                current_block = ChangeBlock(context_before=ctx_before)

            current_block.items.extend(change_items)
            total_items += len(change_items)

            if truncated:
                break

    # Close any remaining open block
    if current_block is not None and current_block.items:
        blocks.append(current_block)

    return blocks, truncated

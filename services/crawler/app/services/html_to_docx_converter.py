"""
HTML to DOCX section converter.

Parses HTML content and converts it into structured DocxSection dicts
that can be passed to DocxService.generate_docx().

Uses BeautifulSoup for HTML parsing.
"""

import logging
import re
from typing import Any

from bs4 import BeautifulSoup, NavigableString, Tag

logger = logging.getLogger(__name__)

# Heading tags mapped to their levels
_HEADING_TAGS = {"h1": 1, "h2": 2, "h3": 3, "h4": 4, "h5": 5, "h6": 6}

# Container tags that should be recursed into (process children directly)
_CONTAINER_TAGS = {"div", "section", "article", "main", "header", "footer", "nav", "aside"}

# Tags to skip entirely
_SKIP_TAGS = {"script", "style", "meta", "link", "head"}


def _get_text(element: Tag) -> str:
    """Extract clean text from an element, collapsing whitespace."""
    text = element.get_text(separator=" ", strip=True)
    return re.sub(r"\s+", " ", text).strip()


def _parse_list_items(list_tag: Tag) -> list[str]:
    """Extract text from <li> children of a list tag."""
    items: list[str] = []
    for li in list_tag.find_all("li", recursive=False):
        text = _get_text(li)
        if text:
            items.append(text)
    return items


def _parse_table(table_tag: Tag) -> dict[str, Any] | None:
    """Parse an HTML table into headers and rows."""
    headers: list[str] = []
    rows: list[list[str]] = []

    # Try to extract headers from <thead> or first <tr> with <th>
    thead = table_tag.find("thead")
    if thead:
        for th in thead.find_all("th"):
            headers.append(_get_text(th))

    # Extract rows from <tbody> or direct <tr>
    tbody = table_tag.find("tbody") or table_tag
    for tr in tbody.find_all("tr", recursive=False):
        cells = tr.find_all(["td", "th"])
        if not cells:
            continue

        # If no headers found yet and this row has <th> cells, treat as header row
        if not headers and all(cell.name == "th" for cell in cells):
            headers = [_get_text(cell) for cell in cells]
            continue

        row = [_get_text(cell) for cell in cells]
        rows.append(row)

    if not headers and not rows:
        return None

    # If still no headers, generate generic ones
    if not headers and rows:
        col_count = max(len(r) for r in rows)
        headers = [f"Column {i + 1}" for i in range(col_count)]

    # Normalize row lengths to match headers
    for i, row in enumerate(rows):
        if len(row) < len(headers):
            rows[i] = row + [""] * (len(headers) - len(row))
        elif len(row) > len(headers):
            rows[i] = row[: len(headers)]

    return {"headers": headers, "rows": rows}


def _process_element(
    element: Tag,
    sections: list[dict[str, Any]],
    title_ref: list[str | None],
) -> None:
    """
    Process a single HTML element and append sections.

    Uses title_ref as a mutable container for the document title (first h1).
    """
    tag_name = element.name.lower()

    if tag_name in _SKIP_TAGS:
        return

    # Headings
    if tag_name in _HEADING_TAGS:
        text = _get_text(element)
        if not text:
            return
        level = _HEADING_TAGS[tag_name]
        if level == 1 and title_ref[0] is None:
            title_ref[0] = text
        else:
            sections.append({"type": "heading", "level": level, "text": text})
        return

    # Unordered list
    if tag_name == "ul":
        items = _parse_list_items(element)
        if items:
            sections.append({"type": "bullets", "items": items})
        return

    # Ordered list
    if tag_name == "ol":
        items = _parse_list_items(element)
        if items:
            sections.append({"type": "numbered", "items": items})
        return

    # Table
    if tag_name == "table":
        table_data = _parse_table(element)
        if table_data:
            sections.append({"type": "table", **table_data})
        return

    # Blockquote
    if tag_name == "blockquote":
        text = _get_text(element)
        if text:
            sections.append({"type": "quote", "text": text})
        return

    # Code block (pre or pre>code)
    if tag_name == "pre":
        code_tag = element.find("code")
        text = code_tag.get_text() if code_tag else element.get_text()
        if text.strip():
            sections.append({"type": "code", "text": text.strip()})
        return

    # Container tags — recurse into children directly (no re-parsing)
    if tag_name in _CONTAINER_TAGS:
        _process_children(element, sections, title_ref)
        return

    # Paragraph and everything else with text
    text = _get_text(element)
    if text:
        sections.append({"type": "paragraph", "text": text})


def _process_children(
    parent: Tag,
    sections: list[dict[str, Any]],
    title_ref: list[str | None],
) -> None:
    """Process all direct children of a parent element."""
    for child in parent.children:
        if isinstance(child, NavigableString):
            text = child.strip()
            if text:
                sections.append({"type": "paragraph", "text": text})
            continue

        if isinstance(child, Tag):
            _process_element(child, sections, title_ref)


def html_to_sections(html: str) -> dict[str, Any]:
    """
    Convert HTML content to a structured content dict for DocxService.

    Returns:
        Dict with "title" and "sections" list.
        Each section has "type" and appropriate content fields.
    """
    soup = BeautifulSoup(html, "html.parser")

    # Find the body, or use the whole document
    body = soup.find("body") or soup

    sections: list[dict[str, Any]] = []
    title_ref: list[str | None] = [None]

    _process_children(body, sections, title_ref)

    return {
        "title": title_ref[0] or "Untitled Document",
        "sections": sections,
    }

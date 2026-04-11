"""
HTML to PPTX slide converter.

Parses HTML content and converts it into structured slide dicts
that can be passed to PptxService.generate_pptx_from_content().

Uses BeautifulSoup for HTML parsing. Each top-level heading (h1/h2)
starts a new slide; content between headings becomes bullet points
or text content on that slide.
"""

import logging
import re
from typing import Any

from bs4 import BeautifulSoup, NavigableString, Tag

logger = logging.getLogger(__name__)

# Heading tags that start a new slide
_SLIDE_BREAK_TAGS = {"h1", "h2"}

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

    thead = table_tag.find("thead")
    if thead:
        for th in thead.find_all("th"):
            headers.append(_get_text(th))

    tbody = table_tag.find("tbody") or table_tag
    for tr in tbody.find_all("tr", recursive=False):
        cells = tr.find_all(["td", "th"])
        if not cells:
            continue

        if not headers and all(cell.name == "th" for cell in cells):
            headers = [_get_text(cell) for cell in cells]
            continue

        row = [_get_text(cell) for cell in cells]
        rows.append(row)

    if not headers and not rows:
        return None

    if not headers and rows:
        col_count = max(len(r) for r in rows)
        headers = [f"Column {i + 1}" for i in range(col_count)]

    for i, row in enumerate(rows):
        if len(row) < len(headers):
            rows[i] = row + [""] * (len(headers) - len(row))
        elif len(row) > len(headers):
            rows[i] = row[: len(headers)]

    return {"headers": headers, "rows": rows}


def _flush_slide(
    slides: list[dict[str, Any]],
    title: str | None,
    subtitle: str | None,
    text_content: list[str],
    bullet_points: list[str],
    tables: list[dict[str, Any]],
) -> None:
    """Flush accumulated content into a slide dict."""
    if not title and not text_content and not bullet_points and not tables:
        return

    slide: dict[str, Any] = {}
    if title:
        slide["title"] = title
    if subtitle:
        slide["subtitle"] = subtitle
    if text_content:
        slide["textContent"] = text_content
    if bullet_points:
        slide["bulletPoints"] = bullet_points
    if tables:
        slide["tables"] = tables

    slides.append(slide)


def _collect_content(
    element: Tag,
    text_content: list[str],
    bullet_points: list[str],
    tables: list[dict[str, Any]],
) -> None:
    """Collect content from an element into the appropriate lists."""
    tag_name = element.name.lower()

    if tag_name in _SKIP_TAGS:
        return

    # Lists become bullet points
    if tag_name in ("ul", "ol"):
        items = _parse_list_items(element)
        bullet_points.extend(items)
        return

    # Tables
    if tag_name == "table":
        table_data = _parse_table(element)
        if table_data:
            tables.append(table_data)
        return

    # Container tags — recurse into children
    if tag_name in ("div", "section", "article", "main", "header", "footer", "nav", "aside"):
        for child in element.children:
            if isinstance(child, NavigableString):
                text = child.strip()
                if text:
                    text_content.append(text)
            elif isinstance(child, Tag):
                _collect_content(child, text_content, bullet_points, tables)
        return

    # Sub-headings (h3-h6) become bold text content within a slide
    if tag_name in ("h3", "h4", "h5", "h6"):
        text = _get_text(element)
        if text:
            text_content.append(text)
        return

    # Code blocks
    if tag_name == "pre":
        code_tag = element.find("code")
        text = code_tag.get_text() if code_tag else element.get_text()
        if text.strip():
            text_content.append(text.strip())
        return

    # Paragraph and everything else with text
    text = _get_text(element)
    if text:
        text_content.append(text)


def html_to_slides(html: str) -> list[dict[str, Any]]:
    """
    Convert HTML content to a list of slide content dicts for PptxService.

    Each h1/h2 heading starts a new slide. Content between headings
    becomes textContent or bulletPoints on that slide.

    Returns:
        List of slide dicts with title, subtitle, textContent, bulletPoints, tables.
    """
    soup = BeautifulSoup(html, "html.parser")
    body = soup.find("body") or soup

    slides: list[dict[str, Any]] = []

    # Current slide accumulation
    current_title: str | None = None
    current_subtitle: str | None = None
    current_text: list[str] = []
    current_bullets: list[str] = []
    current_tables: list[dict[str, Any]] = []

    for child in body.children:
        if isinstance(child, NavigableString):
            text = child.strip()
            if text:
                current_text.append(text)
            continue

        if not isinstance(child, Tag):
            continue

        tag_name = child.name.lower()

        if tag_name in _SKIP_TAGS:
            continue

        # h1/h2 starts a new slide
        if tag_name in _SLIDE_BREAK_TAGS:
            # Flush previous slide
            _flush_slide(slides, current_title, current_subtitle, current_text, current_bullets, current_tables)
            current_title = _get_text(child)
            current_subtitle = None
            current_text = []
            current_bullets = []
            current_tables = []
            continue

        # h3 right after a title with no content yet becomes subtitle
        if tag_name == "h3" and current_title and not current_text and not current_bullets and not current_subtitle:
            current_subtitle = _get_text(child)
            continue

        _collect_content(child, current_text, current_bullets, current_tables)

    # Flush final slide
    _flush_slide(slides, current_title, current_subtitle, current_text, current_bullets, current_tables)

    # If no slides were created (no headings found), create a single slide from all content
    if not slides and (current_text or current_bullets or current_tables):
        slide: dict[str, Any] = {"title": "Untitled Slide"}
        if current_text:
            slide["textContent"] = current_text
        if current_bullets:
            slide["bulletPoints"] = current_bullets
        if current_tables:
            slide["tables"] = current_tables
        slides.append(slide)

    return slides

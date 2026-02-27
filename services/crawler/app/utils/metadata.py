"""Shared metadata extraction utilities."""


def extract_meta_description(structured_data: dict | None) -> str | None:
    """Extract meta description from structured data (meta tags or OpenGraph)."""
    if not structured_data:
        return None
    meta = structured_data.get("meta", {})
    if desc := meta.get("description"):
        return desc
    og = structured_data.get("opengraph", {})
    if desc := og.get("og:description"):
        return desc
    return None

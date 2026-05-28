"""Org slug sanitization for multi-tenant document storage."""

import re


def sanitize_org_slug(org_slug: str) -> str:
    """Sanitize an org_slug by replacing invalid characters.

    - Spaces and dots replaced with underscores
    - Non-alphanumeric/underscore/hyphen characters removed
    - Collapses multiple underscores, strips leading/trailing underscores

    Raises:
        ValueError: If org_slug sanitizes to empty string.
    """
    if not org_slug:
        raise ValueError("org_slug must not be empty")

    result = org_slug.replace(" ", "_").replace(".", "_")
    result = re.sub(r"[^a-zA-Z0-9_-]", "", result)
    result = re.sub(r"_+", "_", result)
    result = result.strip("_")

    if not result:
        raise ValueError(f"org_slug '{org_slug}' sanitized to empty string")

    return result

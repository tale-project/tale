"""Team ID sanitization for multi-tenant document storage."""

import re


def sanitize_team_id(team_id: str) -> str:
    """Sanitize a team_id by replacing invalid characters.

    - Spaces and dots replaced with underscores
    - Non-alphanumeric/underscore/hyphen characters removed
    - Collapses multiple underscores, strips leading/trailing underscores

    Raises:
        ValueError: If team_id sanitizes to empty string.
    """
    if not team_id:
        return team_id

    result = team_id.replace(" ", "_").replace(".", "_")
    result = re.sub(r"[^a-zA-Z0-9_-]", "", result)
    result = re.sub(r"_+", "_", result)
    result = result.strip("_")

    if not result:
        raise ValueError(f"team_id '{team_id}' sanitized to empty string")

    return result

"""Folder path normalization for the folder-scoped search filter.

The platform's canonical folder path format is ``parent/child`` — segments
joined by ``/`` with no leading or trailing slash (see
``services/platform/convex/folders/queries.ts::buildFolderPath``). The
TypeScript twin of this helper lives at
``services/platform/convex/lib/helpers/rag_folder_path.ts`` — keep both in
sync.
"""

from __future__ import annotations

MAX_FOLDER_PATH_LENGTH = 1024

_STRIP_CHARS = " \t\r\n/"


def normalize_folder_path(value: object) -> str | None:
    """Normalize a folder path to the canonical ``parent/child`` form.

    Strips surrounding whitespace and slashes. Returns ``None`` for
    non-string, empty, or all-separator values so callers can treat the
    result as "no folder".
    """
    if not isinstance(value, str):
        return None
    normalized = value.strip(_STRIP_CHARS)
    return normalized or None

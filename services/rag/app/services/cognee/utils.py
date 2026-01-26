"""Cognee result normalization utilities.

This module provides helper functions to normalize results from
cognee.add() and cognee.search() into consistent dictionary formats.
"""

import hashlib
import re
from pathlib import Path
from typing import Any

import aiofiles
from loguru import logger


async def compute_file_hash(file_path: str | Path) -> str:
    """Compute SHA-256 hash of a file's content.

    Args:
        file_path: Path to the file

    Returns:
        Hex-encoded SHA-256 hash string
    """
    sha256 = hashlib.sha256()
    async with aiofiles.open(file_path, "rb") as f:
        while chunk := await f.read(8192):
            sha256.update(chunk)
    return sha256.hexdigest()


def _safe_int(value: Any) -> int:
    """Safely convert a value to int, handling floats like 10.0.

    Args:
        value: The value to convert (int, float, or str)

    Returns:
        Integer value, or 0 if conversion fails
    """
    try:
        if isinstance(value, (int, float)):
            return int(value)
        if isinstance(value, str):
            # Handle both "10" and "10.0"
            return int(float(value))
    except (ValueError, TypeError):
        pass
    return 0


def normalize_add_result(
    result: Any,
    document_id: str | None = None,
) -> tuple[str, int]:
    """Normalize the result from cognee.add() into document_id and chunks_created.

    Args:
        result: The raw result from cognee.add()
        document_id: Optional document ID provided by the caller

    Returns:
        Tuple of (document_id, chunks_created)
    """
    doc_id: str = document_id or "unknown"
    chunks_created: int = 0

    try:
        if isinstance(result, dict):
            doc_id = document_id or result.get("id") or result.get("document_id") or "unknown"
            raw_chunks = result.get("chunks", 0)
            chunks_created = _safe_int(raw_chunks)
        else:
            # Try attribute-style access
            doc_id = (
                document_id
                or getattr(result, "id", None)
                or getattr(result, "document_id", None)
                or "unknown"
            )
            maybe_chunks = getattr(result, "chunks", 0)
            chunks_created = _safe_int(maybe_chunks)
    except Exception as norm_err:
        logger.debug(f"Could not normalize cognee.add() result ({type(result)}): {norm_err}")

    return doc_id, chunks_created


def normalize_search_result(result: Any) -> dict[str, Any]:
    """Normalize a single search result into a consistent dictionary format.

    Args:
        result: A single result (chunk) from cognee.search()

    Returns:
        Dictionary with content, score, document_id, and metadata
    """
    if isinstance(result, str):
        return {
            "content": result,
            "score": 1.0,
            "document_id": None,
            "metadata": {},
        }
    elif isinstance(result, dict):
        # Extract content from chunk payload (use 'text' field from DocumentChunk)
        content = result.get("text", result.get("content", ""))

        # Build metadata, excluding large vector fields like text_vector
        metadata: dict[str, Any] = {}
        for key in ("chunk_size", "chunk_index", "cut_type", "type"):
            if key in result:
                metadata[key] = result[key]

        return {
            "content": content,
            "score": result.get("score", result.get("similarity", 1.0)),
            "document_id": result.get("id", result.get("document_id")),
            "metadata": metadata,
        }
    else:
        # Try to convert to dict if it has attributes
        try:
            return {
                "content": getattr(result, "text", getattr(result, "content", str(result))),
                "score": getattr(result, "score", 1.0),
                "document_id": getattr(result, "id", getattr(result, "document_id", None)),
                "metadata": {},
            }
        except Exception as conv_err:
            logger.warning(f"Could not normalize search result ({type(result)}): {conv_err}")
            return {
                "content": str(result),
                "score": 1.0,
                "document_id": None,
                "metadata": {},
            }


def normalize_search_results(raw_results: list[Any]) -> list[dict[str, Any]]:
    """Normalize a list of search results into consistent dictionary format.

    Args:
        raw_results: List of raw results from cognee.search()

    Returns:
        List of normalized result dictionaries
    """
    return [normalize_search_result(r) for r in raw_results]


# Dataset name prefix for team-level isolation
TEAM_DATASET_PREFIX = "tale_team_"

# Characters not allowed in Cognee dataset names (from check_dataset_name.py)
DATASET_INVALID_CHARS = frozenset({" ", "."})

# Characters allowed in team_id (safe for both dataset names and email local parts)
# Alphanumeric, underscore, hyphen are safe everywhere
TEAM_ID_ALLOWED_PATTERN = r"^[a-zA-Z0-9_-]+$"

_TEAM_ID_PATTERN = re.compile(TEAM_ID_ALLOWED_PATTERN)


def validate_team_id(team_id: str) -> bool:
    """Validate that a team_id is safe for use in Cognee dataset names and emails.

    Cognee dataset names cannot contain spaces or dots. Additionally, we restrict
    team_ids to alphanumeric characters, underscores, and hyphens for safety.

    Args:
        team_id: The team identifier to validate

    Returns:
        True if valid, False otherwise
    """
    if not team_id:
        return False
    return bool(_TEAM_ID_PATTERN.match(team_id))


def sanitize_team_id(team_id: str) -> str:
    """Sanitize a team_id by replacing invalid characters.

    Converts the team_id to a safe format for Cognee:
    - Spaces are replaced with underscores
    - Dots are replaced with underscores
    - Other special characters are removed

    Args:
        team_id: The team identifier to sanitize

    Returns:
        Sanitized team_id safe for use in dataset names and emails

    Raises:
        ValueError: If team_id sanitizes to empty string (prevents dataset collisions)
    """
    if not team_id:
        return team_id

    # Replace common problematic characters
    result = team_id.replace(" ", "_").replace(".", "_")

    # Remove any remaining characters that aren't alphanumeric, underscore, or hyphen
    result = re.sub(r"[^a-zA-Z0-9_-]", "", result)

    # Collapse multiple underscores
    result = re.sub(r"_+", "_", result)

    # Remove leading/trailing underscores
    result = result.strip("_")

    if not result:
        raise ValueError(f"team_id '{team_id}' sanitized to empty string")

    return result


def extract_team_id_from_dataset(dataset_name: str | None) -> str | None:
    """Extract team ID from a dataset name.

    Dataset names follow the format:
    - 'tale_team_{teamId}' for team-level datasets
    - 'tale_documents' for organization-level datasets

    Args:
        dataset_name: The dataset name (e.g., 'tale_team_abc123' or 'tale_documents')

    Returns:
        team_id if dataset is team-scoped, None otherwise
    """
    if dataset_name and dataset_name.startswith(TEAM_DATASET_PREFIX):
        return dataset_name[len(TEAM_DATASET_PREFIX):]
    return None


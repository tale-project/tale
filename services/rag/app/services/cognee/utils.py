"""Cognee result normalization utilities.

This module provides helper functions to normalize results from
cognee.add() and cognee.search() into consistent dictionary formats.
"""

from typing import Any

from loguru import logger


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


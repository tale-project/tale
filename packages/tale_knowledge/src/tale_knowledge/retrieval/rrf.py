"""Reciprocal Rank Fusion (RRF) for merging ranked search results.

Pure function — no database or service dependencies. Both services provide
their own result types; RRF operates on (id, rank) tuples.
"""

from typing import Any

RRF_K = 60


def merge_rrf(
    ranked_lists: list[list[dict[str, Any]]],
    limit: int,
    *,
    id_key: str = "id",
    k: int = RRF_K,
) -> list[dict[str, Any]]:
    """Merge multiple ranked lists using Reciprocal Rank Fusion.

    Args:
        ranked_lists: List of ranked result lists (each item must have `id_key`).
        limit: Maximum number of results to return.
        id_key: Key to use as unique identifier in result dicts.
        k: RRF constant (default 60).

    Returns:
        Merged list of result dicts with added "rrf_score" key, sorted by score.
    """
    if k < 1:
        raise ValueError(f"RRF constant k must be >= 1, got {k}")
    if limit < 0:
        raise ValueError(f"limit must be >= 0, got {limit}")

    scores: dict[Any, float] = {}
    items: dict[Any, dict[str, Any]] = {}

    for ranked in ranked_lists:
        for rank, item in enumerate(ranked):
            item_id = item[id_key]
            rrf_score = 1.0 / (k + rank + 1)
            scores[item_id] = scores.get(item_id, 0.0) + rrf_score
            items[item_id] = item

    sorted_ids = sorted(scores, key=lambda i: scores[i], reverse=True)[:limit]

    max_score = scores[sorted_ids[0]] if sorted_ids else 1.0

    return [
        {**items[item_id], "rrf_score": scores[item_id] / max_score}
        for item_id in sorted_ids
    ]

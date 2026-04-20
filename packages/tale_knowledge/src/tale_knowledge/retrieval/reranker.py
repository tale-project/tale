"""Cross-encoder re-ranking for search results.

Supports two modes:
- local: Uses sentence-transformers CrossEncoder for on-device scoring.
- api: Calls an external provider API with a scoring prompt.
"""

from __future__ import annotations

import asyncio
from typing import Any

from loguru import logger


class Reranker:
    """Re-ranks search results using a cross-encoder model.

    Args:
        model_name: Model identifier (e.g. "cross-encoder/ms-marco-MiniLM-L-6-v2").
        provider: "local" for sentence-transformers or "api" for external provider.
        api_base_url: Base URL when provider is "api".
        api_key: API key when provider is "api".
    """

    def __init__(
        self,
        model_name: str = "cross-encoder/ms-marco-MiniLM-L-6-v2",
        provider: str = "local",
        api_base_url: str | None = None,
        api_key: str | None = None,
    ):
        self._model_name = model_name
        self._provider = provider
        self._api_base_url = api_base_url
        self._api_key = api_key
        self._cross_encoder: Any | None = None
        self._load_lock = asyncio.Lock()

    async def _ensure_local_model(self) -> Any:
        """Lazy-load the local cross-encoder model."""
        if self._cross_encoder is not None:
            return self._cross_encoder

        async with self._load_lock:
            if self._cross_encoder is not None:
                return self._cross_encoder

            loop = asyncio.get_running_loop()
            self._cross_encoder = await loop.run_in_executor(None, self._load_cross_encoder)
            return self._cross_encoder

    def _load_cross_encoder(self) -> Any:
        """Load sentence-transformers CrossEncoder (blocking, run in executor)."""
        try:
            from sentence_transformers import CrossEncoder

            model = CrossEncoder(self._model_name)
            logger.info("Loaded cross-encoder model: {}", self._model_name)
            return model
        except ImportError:
            logger.error("sentence-transformers not installed. Install with: pip install sentence-transformers")
            raise
        except Exception:
            logger.error(
                "Failed to load cross-encoder model: {}",
                self._model_name,
                exc_info=True,
            )
            raise

    async def rerank(
        self,
        query: str,
        results: list[dict[str, Any]],
        *,
        top_k: int = 10,
    ) -> list[dict[str, Any]]:
        """Re-rank results using the cross-encoder.

        Adds a ``reranking_score`` field to each result dict and returns
        the top_k results sorted by descending reranking score.

        Args:
            query: Original search query.
            results: List of result dicts (must have "content" or "chunk_content" key).
            top_k: Maximum number of results to return after re-ranking.

        Returns:
            Re-ranked and trimmed result list with ``reranking_score`` added.
        """
        if not results:
            return []

        if self._provider == "local":
            return await self._rerank_local(query, results, top_k)
        return await self._rerank_api(query, results, top_k)

    async def _rerank_local(
        self,
        query: str,
        results: list[dict[str, Any]],
        top_k: int,
    ) -> list[dict[str, Any]]:
        """Re-rank using local sentence-transformers CrossEncoder."""
        cross_encoder = await self._ensure_local_model()

        pairs = [(query, r.get("content") or r.get("chunk_content", "")) for r in results]

        loop = asyncio.get_running_loop()
        scores = await loop.run_in_executor(None, lambda: cross_encoder.predict(pairs).tolist())

        for result, score in zip(results, scores, strict=True):
            result["reranking_score"] = float(score)

        results.sort(key=lambda r: r.get("reranking_score", 0), reverse=True)

        # Normalize scores to 0-1 range
        if results:
            max_score = results[0].get("reranking_score", 1.0)
            min_score = results[-1].get("reranking_score", 0.0)
            score_range = max_score - min_score
            if score_range > 0:
                for r in results:
                    r["reranking_score"] = (r["reranking_score"] - min_score) / score_range

        return results[:top_k]

    async def _rerank_api(
        self,
        query: str,
        results: list[dict[str, Any]],
        top_k: int,
    ) -> list[dict[str, Any]]:
        """Re-rank using an external API provider."""
        if not self._api_base_url:
            logger.warning("API reranking requested but no api_base_url configured, returning original results")
            return results[:top_k]

        try:
            import httpx

            documents = [r.get("content") or r.get("chunk_content", "") for r in results]

            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{self._api_base_url}/rerank",
                    json={
                        "model": self._model_name,
                        "query": query,
                        "documents": documents,
                        "top_n": top_k,
                    },
                    headers=({"Authorization": f"Bearer {self._api_key}"} if self._api_key else {}),
                )
                response.raise_for_status()
                data = response.json()

            ranked_results = []
            for item in data.get("results", []):
                idx = item["index"]
                if idx < len(results):
                    result = results[idx].copy()
                    result["reranking_score"] = float(item.get("relevance_score", 0))
                    ranked_results.append(result)

            ranked_results.sort(key=lambda r: r.get("reranking_score", 0), reverse=True)
            return ranked_results[:top_k]
        except Exception:
            logger.warning("API reranking failed, returning original results", exc_info=True)
            return results[:top_k]

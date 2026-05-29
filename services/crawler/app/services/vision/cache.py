"""LLM result caching.

This module provides caching for LLM API results (OCR, image description,
text processing) to avoid redundant API calls when processing the same
content multiple times.

Cache strategy:
- Uses SHA-256 hash + active org slug as cache key
- In-memory LRU cache for fast access (O(1) operations via OrderedDict)
- Separate caches for OCR, image description, and LLM processing results
- Cache entries are scoped per org: two orgs hitting the same input do
  NOT share cached output (different providers/prompts could yield
  different results, and the result text itself may be sensitive).
"""

import hashlib
from collections import OrderedDict

from loguru import logger

from app.org_context import get_active_org

CACHE_SIZE = 5000


def compute_image_hash(image_bytes: bytes) -> str:
    """Compute SHA-256 hash of image bytes for cache key."""
    return hashlib.sha256(image_bytes).hexdigest()


def compute_text_hash(text: str) -> str:
    """Compute SHA-256 hash of text string for cache key."""
    return hashlib.sha256(text.encode()).hexdigest()


def _scoped_key(content_hash: str) -> str:
    """Prepend active org slug to a content hash so cache entries do not
    leak between orgs.

    The org slug is required for any cache lookup; if it cannot be
    resolved (caller forgot to set the ContextVar) `get_active_org`
    raises and the caller never gets a cross-org hit by accident.
    """
    return f"{get_active_org()}:{content_hash}"


class LlmCache:
    """Cache for Vision API results.

    Uses OrderedDict for O(1) LRU operations via move_to_end() and popitem().
    """

    def __init__(self) -> None:
        self._ocr_cache: OrderedDict[str, str] = OrderedDict()
        self._description_cache: OrderedDict[str, str] = OrderedDict()
        self._llm_cache: OrderedDict[str, str] = OrderedDict()

    def _evict_if_needed(self, cache: OrderedDict[str, str]) -> None:
        """Evict oldest entries if cache exceeds max size."""
        while len(cache) >= CACHE_SIZE:
            cache.popitem(last=False)

    def get_ocr(self, image_bytes: bytes) -> tuple[str | None, str]:
        """Get cached OCR result."""
        image_hash = _scoped_key(compute_image_hash(image_bytes))
        if image_hash in self._ocr_cache:
            self._ocr_cache.move_to_end(image_hash)
            logger.debug(f"Cache HIT (OCR): {image_hash[:24]}...")
            return self._ocr_cache[image_hash], image_hash
        return None, image_hash

    def set_ocr(self, image_hash: str, result: str) -> None:
        """Store OCR result in cache.

        `image_hash` must be the value returned by `get_ocr` (already
        org-scoped).
        """
        self._evict_if_needed(self._ocr_cache)
        self._ocr_cache[image_hash] = result
        self._ocr_cache.move_to_end(image_hash)

    def get_description(self, image_bytes: bytes) -> tuple[str | None, str]:
        """Get cached image description."""
        image_hash = _scoped_key(compute_image_hash(image_bytes))
        if image_hash in self._description_cache:
            self._description_cache.move_to_end(image_hash)
            logger.debug(f"Cache HIT (description): {image_hash[:24]}...")
            return self._description_cache[image_hash], image_hash
        return None, image_hash

    def set_description(self, image_hash: str, result: str) -> None:
        """Store image description in cache.

        `image_hash` must be the value returned by `get_description`.
        """
        self._evict_if_needed(self._description_cache)
        self._description_cache[image_hash] = result
        self._description_cache.move_to_end(image_hash)

    def get_llm(self, cache_key: str) -> str | None:
        """Get cached LLM processing result.

        `cache_key` is treated as caller-supplied content; the active
        org slug is prepended internally so the same `(chunk, prompt,
        model)` tuple from two orgs never collides.
        """
        scoped = _scoped_key(cache_key)
        if scoped in self._llm_cache:
            self._llm_cache.move_to_end(scoped)
            logger.debug(f"Cache HIT (LLM): {scoped[:24]}...")
            return self._llm_cache[scoped]
        return None

    def set_llm(self, cache_key: str, result: str) -> None:
        """Store LLM processing result in cache."""
        scoped = _scoped_key(cache_key)
        self._evict_if_needed(self._llm_cache)
        self._llm_cache[scoped] = result
        self._llm_cache.move_to_end(scoped)

    def get_stats(self) -> dict[str, int]:
        """Get cache statistics."""
        return {
            "ocr_cache_size": len(self._ocr_cache),
            "description_cache_size": len(self._description_cache),
            "llm_cache_size": len(self._llm_cache),
        }

    def clear(self) -> None:
        """Clear all caches."""
        self._ocr_cache.clear()
        self._description_cache.clear()
        self._llm_cache.clear()
        logger.info("LLM cache cleared")


llm_cache = LlmCache()

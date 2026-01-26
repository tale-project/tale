"""Vision API result caching.

This module provides caching for Vision API results to avoid redundant API calls
when processing the same images multiple times (e.g., during retries or
re-processing).

Cache strategy:
- Uses SHA-256 hash of image bytes as cache key
- In-memory LRU cache for fast access
- Separate caches for OCR and image description results
"""

import hashlib
from functools import lru_cache
from typing import Callable

from loguru import logger

# Cache sizes (number of entries)
OCR_CACHE_SIZE = 500
DESCRIPTION_CACHE_SIZE = 1000


def compute_image_hash(image_bytes: bytes) -> str:
    """Compute SHA-256 hash of image bytes for cache key."""
    return hashlib.sha256(image_bytes).hexdigest()


# Use separate caches for OCR and description to avoid key collisions
# and allow different cache sizes based on usage patterns.

@lru_cache(maxsize=OCR_CACHE_SIZE)
def _get_cached_ocr(image_hash: str) -> str | None:
    """Internal cache lookup for OCR results.

    Returns None for cache miss (never stored), empty string for cached empty result.
    """
    # This function is used as a marker - actual caching happens via the decorator
    # When called with a new hash, it returns None (cache miss)
    return None


@lru_cache(maxsize=DESCRIPTION_CACHE_SIZE)
def _get_cached_description(image_hash: str) -> str | None:
    """Internal cache lookup for description results."""
    return None


# Track cache hits/misses for monitoring
_cache_stats = {
    "ocr_hits": 0,
    "ocr_misses": 0,
    "description_hits": 0,
    "description_misses": 0,
}


class VisionCache:
    """Cache for Vision API results."""

    def __init__(self) -> None:
        # Manual cache storage since lru_cache doesn't support setting values
        self._ocr_cache: dict[str, str] = {}
        self._description_cache: dict[str, str] = {}
        self._ocr_access_order: list[str] = []
        self._description_access_order: list[str] = []

    def _evict_if_needed(
        self,
        cache: dict[str, str],
        access_order: list[str],
        max_size: int,
    ) -> None:
        """Evict oldest entries if cache exceeds max size."""
        while len(cache) >= max_size and access_order:
            oldest_key = access_order.pop(0)
            cache.pop(oldest_key, None)

    def _update_access_order(self, access_order: list[str], key: str) -> None:
        """Update access order for LRU tracking."""
        if key in access_order:
            access_order.remove(key)
        access_order.append(key)

    def get_ocr(self, image_bytes: bytes) -> tuple[str | None, str]:
        """Get cached OCR result.

        Args:
            image_bytes: Raw image bytes

        Returns:
            Tuple of (cached_result or None, image_hash)
        """
        image_hash = compute_image_hash(image_bytes)

        if image_hash in self._ocr_cache:
            _cache_stats["ocr_hits"] += 1
            self._update_access_order(self._ocr_access_order, image_hash)
            logger.debug(f"Vision cache HIT (OCR): {image_hash[:16]}...")
            return self._ocr_cache[image_hash], image_hash

        _cache_stats["ocr_misses"] += 1
        return None, image_hash

    def set_ocr(self, image_hash: str, result: str) -> None:
        """Store OCR result in cache.

        Args:
            image_hash: Pre-computed image hash
            result: OCR result to cache
        """
        self._evict_if_needed(
            self._ocr_cache, self._ocr_access_order, OCR_CACHE_SIZE
        )
        self._ocr_cache[image_hash] = result
        self._update_access_order(self._ocr_access_order, image_hash)
        logger.debug(f"Vision cache SET (OCR): {image_hash[:16]}...")

    def get_description(self, image_bytes: bytes) -> tuple[str | None, str]:
        """Get cached image description.

        Args:
            image_bytes: Raw image bytes

        Returns:
            Tuple of (cached_result or None, image_hash)
        """
        image_hash = compute_image_hash(image_bytes)

        if image_hash in self._description_cache:
            _cache_stats["description_hits"] += 1
            self._update_access_order(self._description_access_order, image_hash)
            logger.debug(f"Vision cache HIT (description): {image_hash[:16]}...")
            return self._description_cache[image_hash], image_hash

        _cache_stats["description_misses"] += 1
        return None, image_hash

    def set_description(self, image_hash: str, result: str) -> None:
        """Store image description in cache.

        Args:
            image_hash: Pre-computed image hash
            result: Description result to cache
        """
        self._evict_if_needed(
            self._description_cache,
            self._description_access_order,
            DESCRIPTION_CACHE_SIZE,
        )
        self._description_cache[image_hash] = result
        self._update_access_order(self._description_access_order, image_hash)
        logger.debug(f"Vision cache SET (description): {image_hash[:16]}...")

    def get_stats(self) -> dict[str, int]:
        """Get cache statistics."""
        return {
            **_cache_stats,
            "ocr_cache_size": len(self._ocr_cache),
            "description_cache_size": len(self._description_cache),
        }

    def clear(self) -> None:
        """Clear all caches."""
        self._ocr_cache.clear()
        self._description_cache.clear()
        self._ocr_access_order.clear()
        self._description_access_order.clear()
        logger.info("Vision cache cleared")


# Singleton instance
vision_cache = VisionCache()

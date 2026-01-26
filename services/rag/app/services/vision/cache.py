"""Vision API result caching.

This module provides caching for Vision API results to avoid redundant API calls
when processing the same images multiple times (e.g., during retries or
re-processing).

Cache strategy:
- Uses SHA-256 hash of image bytes as cache key
- In-memory LRU cache for fast access (O(1) operations via OrderedDict)
- Separate caches for OCR and image description results
"""

import hashlib
from collections import OrderedDict

from loguru import logger

# Cache sizes (number of entries)
OCR_CACHE_SIZE = 500
DESCRIPTION_CACHE_SIZE = 1000


def compute_image_hash(image_bytes: bytes) -> str:
    """Compute SHA-256 hash of image bytes for cache key."""
    return hashlib.sha256(image_bytes).hexdigest()


# Track cache hits/misses for monitoring
_cache_stats = {
    "ocr_hits": 0,
    "ocr_misses": 0,
    "description_hits": 0,
    "description_misses": 0,
}


class VisionCache:
    """Cache for Vision API results.

    Uses OrderedDict for O(1) LRU operations via move_to_end() and popitem().
    """

    def __init__(self) -> None:
        self._ocr_cache: OrderedDict[str, str] = OrderedDict()
        self._description_cache: OrderedDict[str, str] = OrderedDict()

    def _evict_if_needed(
        self,
        cache: OrderedDict[str, str],
        max_size: int,
    ) -> None:
        """Evict oldest entries if cache exceeds max size (O(1) per eviction)."""
        while len(cache) >= max_size:
            cache.popitem(last=False)

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
            self._ocr_cache.move_to_end(image_hash)
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
        self._evict_if_needed(self._ocr_cache, OCR_CACHE_SIZE)
        self._ocr_cache[image_hash] = result
        self._ocr_cache.move_to_end(image_hash)
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
            self._description_cache.move_to_end(image_hash)
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
        self._evict_if_needed(self._description_cache, DESCRIPTION_CACHE_SIZE)
        self._description_cache[image_hash] = result
        self._description_cache.move_to_end(image_hash)
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
        logger.info("Vision cache cleared")


# Singleton instance
vision_cache = VisionCache()

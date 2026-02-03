"""Vision API result caching.

This module provides caching for Vision API results to avoid redundant API calls
when processing the same images multiple times.

Cache strategy:
- Uses SHA-256 hash of image bytes as cache key
- In-memory LRU cache for fast access (O(1) operations via OrderedDict)
- Separate caches for OCR and image description results
"""

import hashlib
from collections import OrderedDict

from loguru import logger

CACHE_SIZE = 5000


def compute_image_hash(image_bytes: bytes) -> str:
    """Compute SHA-256 hash of image bytes for cache key."""
    return hashlib.sha256(image_bytes).hexdigest()


class VisionCache:
    """Cache for Vision API results.

    Uses OrderedDict for O(1) LRU operations via move_to_end() and popitem().
    """

    def __init__(self) -> None:
        self._ocr_cache: OrderedDict[str, str] = OrderedDict()
        self._description_cache: OrderedDict[str, str] = OrderedDict()

    def _evict_if_needed(self, cache: OrderedDict[str, str]) -> None:
        """Evict oldest entries if cache exceeds max size."""
        while len(cache) >= CACHE_SIZE:
            cache.popitem(last=False)

    def get_ocr(self, image_bytes: bytes) -> tuple[str | None, str]:
        """Get cached OCR result."""
        image_hash = compute_image_hash(image_bytes)
        if image_hash in self._ocr_cache:
            self._ocr_cache.move_to_end(image_hash)
            logger.debug(f"Cache HIT (OCR): {image_hash[:16]}...")
            return self._ocr_cache[image_hash], image_hash
        return None, image_hash

    def set_ocr(self, image_hash: str, result: str) -> None:
        """Store OCR result in cache."""
        self._evict_if_needed(self._ocr_cache)
        self._ocr_cache[image_hash] = result
        self._ocr_cache.move_to_end(image_hash)

    def get_description(self, image_bytes: bytes) -> tuple[str | None, str]:
        """Get cached image description."""
        image_hash = compute_image_hash(image_bytes)
        if image_hash in self._description_cache:
            self._description_cache.move_to_end(image_hash)
            logger.debug(f"Cache HIT (description): {image_hash[:16]}...")
            return self._description_cache[image_hash], image_hash
        return None, image_hash

    def set_description(self, image_hash: str, result: str) -> None:
        """Store image description in cache."""
        self._evict_if_needed(self._description_cache)
        self._description_cache[image_hash] = result
        self._description_cache.move_to_end(image_hash)

    def get_stats(self) -> dict[str, int]:
        """Get cache statistics."""
        return {
            "ocr_cache_size": len(self._ocr_cache),
            "description_cache_size": len(self._description_cache),
        }

    def clear(self) -> None:
        """Clear all caches."""
        self._ocr_cache.clear()
        self._description_cache.clear()
        logger.info("Vision cache cleared")


vision_cache = VisionCache()

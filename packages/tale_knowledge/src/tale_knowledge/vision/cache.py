"""Vision API result caching.

Uses SHA-256 hash of image bytes as cache key with in-memory LRU cache
(O(1) operations via OrderedDict). Separate caches for OCR and image
description results with configurable sizes and hit/miss stats.
"""

import hashlib
from collections import OrderedDict

from loguru import logger

OCR_CACHE_SIZE = 500
DESCRIPTION_CACHE_SIZE = 1000


def compute_image_hash(image_bytes: bytes) -> str:
    """Compute SHA-256 hash of image bytes for cache key."""
    return hashlib.sha256(image_bytes).hexdigest()


class VisionCache:
    """LRU cache for Vision API results.

    Uses OrderedDict for O(1) LRU operations via move_to_end() and popitem().
    """

    def __init__(
        self,
        ocr_cache_size: int = OCR_CACHE_SIZE,
        description_cache_size: int = DESCRIPTION_CACHE_SIZE,
    ) -> None:
        self._ocr_cache: OrderedDict[str, str] = OrderedDict()
        self._description_cache: OrderedDict[str, str] = OrderedDict()
        self._ocr_max = ocr_cache_size
        self._desc_max = description_cache_size
        self._stats = {
            "ocr_hits": 0,
            "ocr_misses": 0,
            "description_hits": 0,
            "description_misses": 0,
        }

    def _evict_if_needed(self, cache: OrderedDict[str, str], max_size: int) -> None:
        while len(cache) >= max_size:
            cache.popitem(last=False)

    def get_ocr(self, image_bytes: bytes) -> tuple[str | None, str]:
        """Get cached OCR result. Returns (cached_result_or_None, image_hash)."""
        image_hash = compute_image_hash(image_bytes)
        if image_hash in self._ocr_cache:
            self._stats["ocr_hits"] += 1
            self._ocr_cache.move_to_end(image_hash)
            logger.debug(f"Vision cache HIT (OCR): {image_hash[:16]}...")
            return self._ocr_cache[image_hash], image_hash
        self._stats["ocr_misses"] += 1
        return None, image_hash

    def set_ocr(self, image_hash: str, result: str) -> None:
        self._evict_if_needed(self._ocr_cache, self._ocr_max)
        self._ocr_cache[image_hash] = result
        self._ocr_cache.move_to_end(image_hash)

    def get_description(self, image_bytes: bytes) -> tuple[str | None, str]:
        """Get cached image description. Returns (cached_result_or_None, image_hash)."""
        image_hash = compute_image_hash(image_bytes)
        if image_hash in self._description_cache:
            self._stats["description_hits"] += 1
            self._description_cache.move_to_end(image_hash)
            logger.debug(f"Vision cache HIT (description): {image_hash[:16]}...")
            return self._description_cache[image_hash], image_hash
        self._stats["description_misses"] += 1
        return None, image_hash

    def set_description(self, image_hash: str, result: str) -> None:
        self._evict_if_needed(self._description_cache, self._desc_max)
        self._description_cache[image_hash] = result
        self._description_cache.move_to_end(image_hash)

    def get_stats(self) -> dict[str, int]:
        return {
            **self._stats,
            "ocr_cache_size": len(self._ocr_cache),
            "description_cache_size": len(self._description_cache),
        }

    def clear(self) -> None:
        self._ocr_cache.clear()
        self._description_cache.clear()
        logger.info("Vision cache cleared")

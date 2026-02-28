"""Vision API result caching.

Uses SHA-256 hash of image bytes as cache key with in-memory LRU cache
(O(1) operations via OrderedDict). Separate caches for OCR and image
description results with configurable sizes and hit/miss stats.

Async ``get_or_set_*`` methods use per-key ``asyncio.Lock`` instances so
concurrent callers for the *same* image coalesce into a single Vision API
call while callers for *different* images proceed without contention.
"""

import asyncio
import hashlib
from collections import OrderedDict
from collections.abc import Awaitable, Callable

from loguru import logger

OCR_CACHE_SIZE = 500
DESCRIPTION_CACHE_SIZE = 1000


def compute_image_hash(image_bytes: bytes) -> str:
    """Compute SHA-256 hash of image bytes for cache key."""
    return hashlib.sha256(image_bytes).hexdigest()


class VisionCache:
    """LRU cache for Vision API results.

    Uses OrderedDict for O(1) LRU operations via move_to_end() and popitem().
    Per-key asyncio.Lock instances prevent duplicate Vision API calls when
    multiple coroutines miss the cache for the same image concurrently.
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
        self._ocr_key_locks: dict[str, asyncio.Lock] = {}
        self._description_key_locks: dict[str, asyncio.Lock] = {}
        self._ocr_locks_guard = asyncio.Lock()
        self._description_locks_guard = asyncio.Lock()

    def _evict_if_needed(self, cache: OrderedDict[str, str], max_size: int) -> None:
        while len(cache) >= max_size:
            cache.popitem(last=False)

    async def _acquire_key_lock(
        self,
        key: str,
        key_locks: dict[str, asyncio.Lock],
        guard: asyncio.Lock,
    ) -> asyncio.Lock:
        """Get or create a per-key lock, guarded by a lightweight meta-lock."""
        async with guard:
            if key not in key_locks:
                key_locks[key] = asyncio.Lock()
            return key_locks[key]

    async def _release_key_lock(
        self,
        key: str,
        key_locks: dict[str, asyncio.Lock],
        guard: asyncio.Lock,
    ) -> None:
        """Remove a per-key lock once no one is waiting on it."""
        async with guard:
            lock = key_locks.get(key)
            if lock is not None and not lock.locked():
                key_locks.pop(key, None)

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

    async def get_or_set_ocr(
        self,
        image_bytes: bytes,
        fetch_fn: Callable[[], Awaitable[str]],
    ) -> str:
        """Get cached OCR result or fetch via ``fetch_fn``, with per-key locking.

        Only one coroutine per image hash will call ``fetch_fn``; concurrent
        callers for the same image wait on the per-key lock and then read
        from the cache.
        """
        image_hash = compute_image_hash(image_bytes)

        if image_hash in self._ocr_cache:
            self._stats["ocr_hits"] += 1
            self._ocr_cache.move_to_end(image_hash)
            logger.debug(f"Vision cache HIT (OCR): {image_hash[:16]}...")
            return self._ocr_cache[image_hash]

        key_lock = await self._acquire_key_lock(
            image_hash, self._ocr_key_locks, self._ocr_locks_guard
        )
        try:
            async with key_lock:
                if image_hash in self._ocr_cache:
                    self._stats["ocr_hits"] += 1
                    self._ocr_cache.move_to_end(image_hash)
                    logger.debug(
                        f"Vision cache HIT (OCR, after lock): {image_hash[:16]}..."
                    )
                    return self._ocr_cache[image_hash]

                self._stats["ocr_misses"] += 1
                result = await fetch_fn()
                self.set_ocr(image_hash, result)
                return result
        finally:
            await self._release_key_lock(
                image_hash, self._ocr_key_locks, self._ocr_locks_guard
            )

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

    async def get_or_set_description(
        self,
        image_bytes: bytes,
        fetch_fn: Callable[[], Awaitable[str]],
    ) -> str:
        """Get cached description or fetch via ``fetch_fn``, with per-key locking.

        Only one coroutine per image hash will call ``fetch_fn``; concurrent
        callers for the same image wait on the per-key lock and then read
        from the cache.
        """
        image_hash = compute_image_hash(image_bytes)

        if image_hash in self._description_cache:
            self._stats["description_hits"] += 1
            self._description_cache.move_to_end(image_hash)
            logger.debug(f"Vision cache HIT (description): {image_hash[:16]}...")
            return self._description_cache[image_hash]

        key_lock = await self._acquire_key_lock(
            image_hash, self._description_key_locks, self._description_locks_guard
        )
        try:
            async with key_lock:
                if image_hash in self._description_cache:
                    self._stats["description_hits"] += 1
                    self._description_cache.move_to_end(image_hash)
                    logger.debug(
                        f"Vision cache HIT (description, after lock): {image_hash[:16]}..."
                    )
                    return self._description_cache[image_hash]

                self._stats["description_misses"] += 1
                result = await fetch_fn()
                self.set_description(image_hash, result)
                return result
        finally:
            await self._release_key_lock(
                image_hash, self._description_key_locks, self._description_locks_guard
            )

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

"""Tests for VisionClient constructor injection and caching."""

import asyncio

import pytest

from tale_knowledge.vision.cache import VisionCache


class TestVisionCache:
    def test_ocr_cache_miss(self):
        cache = VisionCache()
        result, image_hash = cache.get_ocr(b"test-image")
        assert result is None
        assert len(image_hash) == 64  # SHA-256 hex

    def test_ocr_cache_hit(self):
        cache = VisionCache()
        _, image_hash = cache.get_ocr(b"test-image")
        cache.set_ocr(image_hash, "extracted text")

        result, _ = cache.get_ocr(b"test-image")
        assert result == "extracted text"

    def test_description_cache_miss(self):
        cache = VisionCache()
        result, _ = cache.get_description(b"test-image")
        assert result is None

    def test_description_cache_hit(self):
        cache = VisionCache()
        _, image_hash = cache.get_description(b"test-image")
        cache.set_description(image_hash, "a photo of a cat")

        result, _ = cache.get_description(b"test-image")
        assert result == "a photo of a cat"

    def test_cache_stats(self):
        cache = VisionCache()
        _, h = cache.get_ocr(b"img1")  # miss
        cache.set_ocr(h, "text")
        cache.get_ocr(b"img1")  # hit

        stats = cache.get_stats()
        assert stats["ocr_hits"] == 1
        assert stats["ocr_misses"] == 1

    def test_cache_eviction(self):
        cache = VisionCache(ocr_cache_size=2)
        cache.set_ocr("hash1", "text1")
        cache.set_ocr("hash2", "text2")
        cache.set_ocr("hash3", "text3")  # should evict hash1

        assert cache._ocr_cache.get("hash1") is None
        assert cache._ocr_cache.get("hash2") == "text2"
        assert cache._ocr_cache.get("hash3") == "text3"

    def test_cache_clear(self):
        cache = VisionCache()
        _, h = cache.get_ocr(b"img")
        cache.set_ocr(h, "text")
        cache.clear()

        stats = cache.get_stats()
        assert stats["ocr_cache_size"] == 0
        assert stats["description_cache_size"] == 0

    def test_custom_cache_sizes(self):
        cache = VisionCache(ocr_cache_size=10, description_cache_size=20)
        assert cache._ocr_max == 10
        assert cache._desc_max == 20

    def test_lru_order(self):
        cache = VisionCache(ocr_cache_size=3)
        cache.set_ocr("h1", "t1")
        cache.set_ocr("h2", "t2")
        # Access h1 to make it recently used
        cache._ocr_cache.move_to_end("h1")
        cache.set_ocr("h3", "t3")
        cache.set_ocr("h4", "t4")  # should evict h2 (least recently used)

        assert cache._ocr_cache.get("h1") == "t1"
        assert cache._ocr_cache.get("h2") is None


class TestVisionCacheAsync:
    @pytest.mark.asyncio
    async def test_get_or_set_ocr_miss_calls_fetch(self):
        cache = VisionCache()
        call_count = 0

        async def fetch():
            nonlocal call_count
            call_count += 1
            return "ocr result"

        result = await cache.get_or_set_ocr(b"image-data", fetch)
        assert result == "ocr result"
        assert call_count == 1

        stats = cache.get_stats()
        assert stats["ocr_misses"] == 1

    @pytest.mark.asyncio
    async def test_get_or_set_ocr_hit_skips_fetch(self):
        cache = VisionCache()
        cache.set_ocr(
            "a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3",
            "cached ocr",
        )

        async def fetch():
            pytest.fail("fetch_fn should not be called on cache hit")

        result = await cache.get_or_set_ocr(b"123", fetch)
        assert result == "cached ocr"

        stats = cache.get_stats()
        assert stats["ocr_hits"] == 1
        assert stats["ocr_misses"] == 0

    @pytest.mark.asyncio
    async def test_get_or_set_description_miss_calls_fetch(self):
        cache = VisionCache()
        call_count = 0

        async def fetch():
            nonlocal call_count
            call_count += 1
            return "a scenic landscape"

        result = await cache.get_or_set_description(b"image-data", fetch)
        assert result == "a scenic landscape"
        assert call_count == 1

        stats = cache.get_stats()
        assert stats["description_misses"] == 1

    @pytest.mark.asyncio
    async def test_get_or_set_description_hit_skips_fetch(self):
        cache = VisionCache()
        cache.set_description(
            "a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3",
            "cached description",
        )

        async def fetch():
            pytest.fail("fetch_fn should not be called on cache hit")

        result = await cache.get_or_set_description(b"123", fetch)
        assert result == "cached description"

        stats = cache.get_stats()
        assert stats["description_hits"] == 1
        assert stats["description_misses"] == 0

    @pytest.mark.asyncio
    async def test_concurrent_ocr_calls_single_fetch(self):
        cache = VisionCache()
        call_count = 0
        fetch_started = asyncio.Event()

        async def slow_fetch():
            nonlocal call_count
            call_count += 1
            fetch_started.set()
            await asyncio.sleep(0.05)
            return "fetched once"

        tasks = [
            asyncio.create_task(cache.get_or_set_ocr(b"same-image", slow_fetch))
            for _ in range(5)
        ]
        results = await asyncio.gather(*tasks)

        assert all(r == "fetched once" for r in results)
        assert call_count == 1

        stats = cache.get_stats()
        assert stats["ocr_misses"] == 1
        assert stats["ocr_hits"] == 4

    @pytest.mark.asyncio
    async def test_concurrent_description_calls_single_fetch(self):
        cache = VisionCache()
        call_count = 0

        async def slow_fetch():
            nonlocal call_count
            call_count += 1
            await asyncio.sleep(0.05)
            return "described once"

        tasks = [
            asyncio.create_task(cache.get_or_set_description(b"same-image", slow_fetch))
            for _ in range(5)
        ]
        results = await asyncio.gather(*tasks)

        assert all(r == "described once" for r in results)
        assert call_count == 1

        stats = cache.get_stats()
        assert stats["description_misses"] == 1
        assert stats["description_hits"] == 4

    @pytest.mark.asyncio
    async def test_different_keys_no_contention(self):
        cache = VisionCache()
        call_count = 0

        async def fetch():
            nonlocal call_count
            call_count += 1
            my_id = call_count
            await asyncio.sleep(0.01)
            return f"result-{my_id}"

        tasks = [
            asyncio.create_task(cache.get_or_set_ocr(f"image-{i}".encode(), fetch))
            for i in range(3)
        ]
        results = await asyncio.gather(*tasks)

        assert call_count == 3
        assert len(set(results)) == 3

    @pytest.mark.asyncio
    async def test_per_key_lock_cleanup(self):
        cache = VisionCache()

        async def fetch():
            return "result"

        await cache.get_or_set_ocr(b"img", fetch)
        assert len(cache._ocr_key_locks) == 0

    @pytest.mark.asyncio
    async def test_fetch_error_does_not_cache(self):
        cache = VisionCache()

        async def failing_fetch():
            raise ValueError("API error")

        with pytest.raises(ValueError, match="API error"):
            await cache.get_or_set_ocr(b"bad-image", failing_fetch)

        stats = cache.get_stats()
        assert stats["ocr_cache_size"] == 0
        assert stats["ocr_misses"] == 1

    @pytest.mark.asyncio
    async def test_fetch_error_releases_lock(self):
        cache = VisionCache()
        call_count = 0

        async def failing_then_ok():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise ValueError("transient error")
            return "recovered"

        with pytest.raises(ValueError):
            await cache.get_or_set_ocr(b"retry-image", failing_then_ok)

        result = await cache.get_or_set_ocr(b"retry-image", failing_then_ok)
        assert result == "recovered"
        assert call_count == 2

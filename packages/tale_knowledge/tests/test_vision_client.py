"""Tests for VisionClient constructor injection and caching."""

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

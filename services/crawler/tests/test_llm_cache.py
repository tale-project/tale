"""Tests for LLM processing cache and chunk processing integration."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.vision.cache import LlmCache, compute_text_hash


class TestComputeTextHash:
    def test_returns_hex_string(self):
        result = compute_text_hash("hello world")
        assert isinstance(result, str)
        assert len(result) == 64

    def test_deterministic(self):
        assert compute_text_hash("test") == compute_text_hash("test")

    def test_different_inputs_different_hashes(self):
        assert compute_text_hash("a") != compute_text_hash("b")


class TestLlmCacheLlm:
    def test_miss_returns_none(self):
        cache = LlmCache()
        assert cache.get_llm("nonexistent") is None

    def test_hit_returns_value(self):
        cache = LlmCache()
        cache.set_llm("key1", "result1")
        assert cache.get_llm("key1") == "result1"

    def test_lru_eviction(self):
        cache = LlmCache()
        from app.services.vision.cache import CACHE_SIZE

        for i in range(CACHE_SIZE + 1):
            cache.set_llm(f"key{i}", f"val{i}")

        assert cache.get_llm("key0") is None
        assert cache.get_llm(f"key{CACHE_SIZE}") == f"val{CACHE_SIZE}"

    def test_stats_includes_llm(self):
        cache = LlmCache()
        cache.set_llm("k", "v")
        stats = cache.get_stats()
        assert stats["llm_cache_size"] == 1

    def test_clear_empties_llm(self):
        cache = LlmCache()
        cache.set_llm("k", "v")
        cache.clear()
        assert cache.get_llm("k") is None
        assert cache.get_stats()["llm_cache_size"] == 0


@pytest.mark.asyncio
class TestProcessPagesWithLlmCache:
    @patch("app.services.vision.openai_client.settings")
    @patch("app.services.vision.openai_client.AsyncOpenAI")
    async def test_second_call_hits_cache(self, mock_openai_cls, mock_settings):
        from app.services.vision.cache import llm_cache
        from app.services.vision.openai_client import process_pages_with_llm

        llm_cache.clear()

        mock_settings.get_chat_config.return_value = ("http://test", "test-key", "test-model")

        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "extracted result"
        mock_response.usage = None

        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
        mock_openai_cls.return_value = mock_client

        result1 = await process_pages_with_llm(["hello world"], "extract info")
        assert result1 == ["extracted result"]
        assert mock_client.chat.completions.create.call_count == 1

        result2 = await process_pages_with_llm(["hello world"], "extract info")
        assert result2 == ["extracted result"]
        assert mock_client.chat.completions.create.call_count == 1

        llm_cache.clear()

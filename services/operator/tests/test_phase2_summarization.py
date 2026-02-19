"""Tests for Phase 2 map-reduce summarization in browser_service."""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.services.browser_service import (
    _PageContent,
    _call_llm,
    _summarize_chunk,
    _summarize_page_content,
)


# ---------------------------------------------------------------------------
# _call_llm
# ---------------------------------------------------------------------------

class TestCallLlm:
    @pytest.mark.asyncio
    async def test_returns_content_on_success(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "choices": [{"message": {"content": "Summary text."}}],
        }

        with patch("app.services.browser_service.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_response
            mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

            result = await _call_llm("test prompt", timeout=10)

        assert result == "Summary text."

    @pytest.mark.asyncio
    async def test_returns_none_on_http_error(self):
        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.text = "Internal Server Error"

        with patch("app.services.browser_service.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_response
            mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

            result = await _call_llm("test prompt", timeout=10)

        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_on_timeout(self):
        with patch("app.services.browser_service.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.post.side_effect = httpx.TimeoutException("timed out")
            mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

            result = await _call_llm("test prompt", timeout=10)

        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_on_generic_error(self):
        with patch("app.services.browser_service.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.post.side_effect = ConnectionError("connection refused")
            mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

            result = await _call_llm("test prompt", timeout=10)

        assert result is None


# ---------------------------------------------------------------------------
# _summarize_chunk
# ---------------------------------------------------------------------------

class TestSummarizeChunk:
    @pytest.mark.asyncio
    async def test_includes_query_and_content_in_prompt(self):
        with patch("app.services.browser_service._call_llm", new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = "Chunk summary"
            result = await _summarize_chunk("page content here", "best strollers 2025", 0)

        assert result == "Chunk summary"
        prompt = mock_llm.call_args[0][0]
        assert "best strollers 2025" in prompt
        assert "page content here" in prompt
        assert "Chunk 1" in prompt

    @pytest.mark.asyncio
    async def test_returns_none_when_llm_fails(self):
        with patch("app.services.browser_service._call_llm", new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = None
            result = await _summarize_chunk("content", "query", 0)

        assert result is None


# ---------------------------------------------------------------------------
# _summarize_page_content
# ---------------------------------------------------------------------------

class TestSummarizePageContent:
    @pytest.mark.asyncio
    async def test_small_content_uses_single_call(self):
        """Content under threshold goes directly to a single LLM call."""
        contents = [
            _PageContent(url="https://example.com/a", content="Short content " * 50),
        ]
        seen = {"https://example.com/a": None}

        with patch("app.services.browser_service._call_llm", new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = "Direct summary."
            result = await _summarize_page_content("test query", contents, seen)

        assert result == "Direct summary."
        assert mock_llm.call_count == 1
        prompt = mock_llm.call_args[0][0]
        assert "test query" in prompt

    @pytest.mark.asyncio
    async def test_large_content_uses_map_reduce(self):
        """Content over threshold triggers map-reduce with parallel calls."""
        contents = [
            _PageContent(url=f"https://example.com/{i}", content="X" * 15_000)
            for i in range(5)
        ]
        seen = {f"https://example.com/{i}": None for i in range(5)}

        call_count = 0

        async def mock_llm(prompt, *, timeout):
            nonlocal call_count
            call_count += 1
            if "Chunk" in prompt:
                return f"Chunk summary {call_count}"
            return "Final synthesized summary."

        with patch("app.services.browser_service._call_llm", side_effect=mock_llm):
            result = await _summarize_page_content("test query", contents, seen)

        assert result == "Final synthesized summary."
        # At least 2 calls: map chunks + 1 reduce
        assert call_count >= 3

    @pytest.mark.asyncio
    async def test_map_partial_failure_still_produces_result(self):
        """When some map chunks fail, reduce uses successful ones."""
        contents = [
            _PageContent(url=f"https://example.com/{i}", content="Y" * 15_000)
            for i in range(4)
        ]
        seen = {f"https://example.com/{i}": None for i in range(4)}

        call_index = 0

        async def mock_llm(prompt, *, timeout):
            nonlocal call_index
            call_index += 1
            if "Chunk" in prompt:
                # Fail every other chunk
                return f"Summary {call_index}" if call_index % 2 == 0 else None
            return "Reduced from partial."

        with patch("app.services.browser_service._call_llm", side_effect=mock_llm):
            result = await _summarize_page_content("query", contents, seen)

        assert result == "Reduced from partial."

    @pytest.mark.asyncio
    async def test_all_map_calls_fail_returns_none(self):
        """When all map chunks fail, returns None."""
        contents = [
            _PageContent(url=f"https://example.com/{i}", content="Z" * 15_000)
            for i in range(3)
        ]
        seen = {f"https://example.com/{i}": None for i in range(3)}

        async def mock_llm(prompt, *, timeout):
            return None

        with patch("app.services.browser_service._call_llm", side_effect=mock_llm):
            result = await _summarize_page_content("query", contents, seen)

        assert result is None

    @pytest.mark.asyncio
    async def test_reduce_failure_returns_none(self):
        """When reduce call fails, returns None."""
        contents = [
            _PageContent(url=f"https://example.com/{i}", content="W" * 15_000)
            for i in range(3)
        ]
        seen = {f"https://example.com/{i}": None for i in range(3)}

        async def mock_llm(prompt, *, timeout):
            if "Chunk" in prompt:
                return "Chunk summary"
            return None  # Reduce fails

        with patch("app.services.browser_service._call_llm", side_effect=mock_llm):
            result = await _summarize_page_content("query", contents, seen)

        assert result is None

    @pytest.mark.asyncio
    async def test_includes_sources_in_prompt(self):
        """Source URLs are included in the synthesis prompt."""
        contents = [
            _PageContent(url="https://example.com/article", content="Article text " * 50),
        ]
        seen = {"https://example.com/article": None, "https://other.com": None}

        with patch("app.services.browser_service._call_llm", new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = "Summary"
            await _summarize_page_content("query", contents, seen)

        prompt = mock_llm.call_args[0][0]
        assert "https://example.com/article" in prompt
        assert "https://other.com" in prompt

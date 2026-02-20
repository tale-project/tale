"""Tests for the LLM agent loop."""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.services.agent_loop import (
    _analyze_screenshot,
    _call_llm_with_tools,
    _execute_tool,
    _fetch_single_page,
    run_agent_loop,
)
from app.services.browser_service import _OutputAccumulator

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _mock_page(url: str = "https://example.com"):
    """Create a mock Playwright Page."""
    page = AsyncMock()
    page.url = url
    page.title = AsyncMock(return_value="Example Page")
    page.goto = AsyncMock(return_value=MagicMock(status=200))
    page.locator = MagicMock(return_value=AsyncMock())
    page.locator.return_value.aria_snapshot = AsyncMock(return_value='- heading "Example"\n- link "Home"')
    page.inner_text = AsyncMock(return_value="Example page content for testing " * 5)
    page.get_by_role = MagicMock(return_value=AsyncMock())
    page.keyboard = AsyncMock()
    page.screenshot = AsyncMock()
    page.go_back = AsyncMock()
    page.wait_for_load_state = AsyncMock()
    return page


def _mock_context(page=None):
    """Create a mock BrowserContext."""
    if page is None:
        page = _mock_page()
    context = AsyncMock()
    context.new_page = AsyncMock(return_value=page)
    return context


def _make_llm_response(content: str | None = None, tool_calls: list | None = None):
    """Build a mock LLM API response dict."""
    message: dict = {"role": "assistant"}
    if content is not None:
        message["content"] = content
    if tool_calls is not None:
        message["tool_calls"] = tool_calls
    else:
        message["content"] = content or ""
    return {
        "choices": [{"message": message, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 100, "completion_tokens": 50},
    }


def _make_tool_call(name: str, args: dict, call_id: str = "call_1"):
    return {
        "id": call_id,
        "type": "function",
        "function": {
            "name": name,
            "arguments": json.dumps(args),
        },
    }


# ---------------------------------------------------------------------------
# _call_llm_with_tools
# ---------------------------------------------------------------------------


class TestCallLlmWithTools:
    @pytest.mark.asyncio
    async def test_returns_response_on_success(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = _make_llm_response("Hello!")

        with patch("app.services.agent_loop.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_response
            mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

            result = await _call_llm_with_tools(
                messages=[{"role": "user", "content": "hi"}],
                tools=[],
                timeout=30.0,
            )

        assert result is not None
        assert result["choices"][0]["message"]["content"] == "Hello!"

    @pytest.mark.asyncio
    async def test_returns_none_on_http_error(self):
        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.text = "Internal Error"

        with patch("app.services.agent_loop.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_response
            mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

            result = await _call_llm_with_tools([], [], 30.0)

        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_on_timeout(self):
        with patch("app.services.agent_loop.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.post.side_effect = httpx.TimeoutException("timed out")
            mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

            result = await _call_llm_with_tools([], [], 30.0)

        assert result is None


# ---------------------------------------------------------------------------
# _execute_tool
# ---------------------------------------------------------------------------


class TestExecuteTool:
    @pytest.mark.asyncio
    async def test_navigate_records_navigation(self):
        page = _mock_page()
        acc = _OutputAccumulator()

        result = await _execute_tool(page, "navigate", {"url": "https://example.com"}, acc, "/tmp")

        assert "Navigated to" in result
        assert acc.navigation_count == 1
        assert "https://example.com" in acc.seen_urls

    @pytest.mark.asyncio
    async def test_snapshot_captures_content(self):
        page = _mock_page()
        acc = _OutputAccumulator()

        result = await _execute_tool(page, "snapshot", {}, acc, "/tmp")

        assert "heading" in result
        assert acc.has_page_content

    @pytest.mark.asyncio
    async def test_click_uses_get_by_role(self):
        page = _mock_page()
        acc = _OutputAccumulator()
        mock_locator = AsyncMock()
        page.get_by_role = MagicMock(return_value=mock_locator)

        result = await _execute_tool(page, "click", {"role": "link", "name": "Home"}, acc, "/tmp")

        assert "Clicked" in result
        page.get_by_role.assert_called_once_with("link", name="Home", exact=False)
        mock_locator.click.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_click_with_index(self):
        page = _mock_page()
        acc = _OutputAccumulator()
        mock_locator = AsyncMock()
        mock_nth = AsyncMock()
        mock_locator.nth = MagicMock(return_value=mock_nth)
        page.get_by_role = MagicMock(return_value=mock_locator)

        result = await _execute_tool(page, "click", {"role": "button", "name": "Submit", "index": 1}, acc, "/tmp")

        assert "Clicked" in result
        mock_locator.nth.assert_called_once_with(1)
        mock_nth.click.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_type_text_fills_and_submits(self):
        page = _mock_page()
        acc = _OutputAccumulator()
        mock_locator = AsyncMock()
        page.get_by_role = MagicMock(return_value=mock_locator)

        result = await _execute_tool(
            page,
            "type_text",
            {"role": "textbox", "name": "Search", "text": "python tutorials", "submit": True},
            acc,
            "/tmp",
        )

        assert "Typed" in result
        assert "submitted" in result
        mock_locator.fill.assert_awaited_once_with("python tutorials")
        mock_locator.press.assert_awaited_once_with("Enter")

    @pytest.mark.asyncio
    async def test_press_key(self):
        page = _mock_page()
        acc = _OutputAccumulator()

        result = await _execute_tool(page, "press_key", {"key": "Escape"}, acc, "/tmp")

        assert "Pressed key: Escape" in result
        page.keyboard.press.assert_awaited_once_with("Escape")

    @pytest.mark.asyncio
    async def test_go_back(self):
        page = _mock_page()
        acc = _OutputAccumulator()

        result = await _execute_tool(page, "go_back", {}, acc, "/tmp")

        assert "Navigated back" in result
        page.go_back.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_wait_for_text(self):
        page = _mock_page()
        acc = _OutputAccumulator()
        mock_locator = AsyncMock()
        page.locator = MagicMock(return_value=mock_locator)

        result = await _execute_tool(page, "wait_for", {"text": "Loading complete"}, acc, "/tmp")

        assert "appeared" in result

    @pytest.mark.asyncio
    async def test_unknown_tool(self):
        page = _mock_page()
        acc = _OutputAccumulator()

        result = await _execute_tool(page, "nonexistent_tool", {}, acc, "/tmp")

        assert "Unknown tool" in result

    @pytest.mark.asyncio
    async def test_error_returns_error_string(self):
        page = _mock_page()
        page.goto = AsyncMock(side_effect=TimeoutError("page load timed out"))
        acc = _OutputAccumulator()

        result = await _execute_tool(page, "navigate", {"url": "https://slow.com"}, acc, "/tmp")

        assert "Error executing navigate" in result
        assert "TimeoutError" in result


# ---------------------------------------------------------------------------
# _analyze_screenshot
# ---------------------------------------------------------------------------


class TestAnalyzeScreenshot:
    @pytest.mark.asyncio
    async def test_returns_analysis_on_success(self, tmp_path):
        img_path = tmp_path / "test.png"
        img_path.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "choices": [{"message": {"content": "A web page showing search results."}}],
        }

        with patch("app.services.agent_loop.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_response
            mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

            result = await _analyze_screenshot(str(img_path))

        assert "search results" in result

    @pytest.mark.asyncio
    async def test_returns_error_on_missing_file(self):
        result = await _analyze_screenshot("/nonexistent/path.png")
        assert "Failed to read" in result


# ---------------------------------------------------------------------------
# run_agent_loop: integration-level tests
# ---------------------------------------------------------------------------


class TestRunAgentLoop:
    @pytest.mark.asyncio
    async def test_simple_text_response_no_tools(self):
        """LLM responds with text directly, no tool calls."""
        context = _mock_context()

        with patch("app.services.agent_loop._call_llm_with_tools", new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = _make_llm_response(content="Here is your answer.")

            result = await run_agent_loop("What is Python?", context, timeout_seconds=60)

        assert result["success"] is True
        assert result["partial"] is False
        assert "Here is your answer." in result["response"]

    @pytest.mark.asyncio
    async def test_navigate_then_respond(self):
        """LLM calls navigate tool, then responds with text."""
        context = _mock_context()

        call_count = 0

        async def mock_llm(messages, tools, timeout):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return _make_llm_response(tool_calls=[_make_tool_call("navigate", {"url": "https://example.com"})])
            return _make_llm_response(content="Found the answer on example.com.")

        with patch("app.services.agent_loop._call_llm_with_tools", side_effect=mock_llm):
            result = await run_agent_loop("Search for info", context, timeout_seconds=60)

        assert result["success"] is True
        assert "Found the answer" in result["response"]
        assert "https://example.com" in result["sources"]

    @pytest.mark.asyncio
    async def test_timeout_returns_partial(self):
        """When timeout is reached, returns partial results."""
        context = _mock_context()

        async def slow_llm(messages, tools, timeout):
            import asyncio

            await asyncio.sleep(0.1)
            return _make_llm_response(tool_calls=[_make_tool_call("navigate", {"url": "https://example.com"})])

        with patch("app.services.agent_loop._call_llm_with_tools", side_effect=slow_llm):
            # Very short timeout to trigger early termination
            result = await run_agent_loop("Search", context, timeout_seconds=1)

        assert result["duration_seconds"] is not None

    @pytest.mark.asyncio
    async def test_llm_failure_returns_gracefully(self):
        """When LLM call fails, loop ends gracefully."""
        context = _mock_context()

        with patch("app.services.agent_loop._call_llm_with_tools", new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = None

            result = await run_agent_loop("Do something", context, timeout_seconds=60)

        assert result["success"] is False
        assert result["duration_seconds"] is not None

    @pytest.mark.asyncio
    async def test_token_usage_accumulated(self):
        """Token usage from LLM calls is accumulated."""
        context = _mock_context()

        call_count = 0

        async def mock_llm(messages, tools, timeout):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                resp = _make_llm_response(tool_calls=[_make_tool_call("snapshot", {})])
                resp["usage"] = {"prompt_tokens": 200, "completion_tokens": 50}
                return resp
            resp = _make_llm_response(content="Done.")
            resp["usage"] = {"prompt_tokens": 300, "completion_tokens": 100}
            return resp

        with patch("app.services.agent_loop._call_llm_with_tools", side_effect=mock_llm):
            result = await run_agent_loop("Describe page", context, timeout_seconds=60)

        assert result["token_usage"]["input_tokens"] == 500
        assert result["token_usage"]["output_tokens"] == 150

    @pytest.mark.asyncio
    async def test_urls_in_response_text_collected_as_sources(self):
        """URLs in the LLM's text response are added to sources."""
        context = _mock_context()

        with patch("app.services.agent_loop._call_llm_with_tools", new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = _make_llm_response(content="Check out https://docs.python.org/3/ for details.")

            result = await run_agent_loop("Find Python docs", context, timeout_seconds=60)

        assert "https://docs.python.org/3/" in result["sources"]

    @pytest.mark.asyncio
    async def test_response_format_matches_contract(self):
        """Response dict has all required keys."""
        context = _mock_context()

        with patch("app.services.agent_loop._call_llm_with_tools", new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = _make_llm_response(content="Answer.")

            result = await run_agent_loop("Question", context, timeout_seconds=60)

        assert "success" in result
        assert "partial" in result
        assert "response" in result
        assert "duration_seconds" in result
        assert "sources" in result

    @pytest.mark.asyncio
    async def test_exception_returns_error(self):
        """Unexpected exception is caught and returned."""
        context = _mock_context()
        context.new_page = AsyncMock(side_effect=RuntimeError("browser crashed"))

        result = await run_agent_loop("Test", context, timeout_seconds=60)

        assert result["success"] is False
        assert "browser crashed" in result["response"]


# ---------------------------------------------------------------------------
# Structured accumulator methods (new methods on _OutputAccumulator)
# ---------------------------------------------------------------------------


class TestAccumulatorStructuredMethods:
    def test_record_navigation_increments_count(self):
        acc = _OutputAccumulator()
        acc.record_navigation("https://example.com")
        acc.record_navigation("https://example.com/page2")
        assert acc.navigation_count == 2

    def test_record_navigation_empty_url_ignored(self):
        acc = _OutputAccumulator()
        acc.record_navigation("")
        assert acc.navigation_count == 0

    def test_record_page_content_stores_content(self):
        acc = _OutputAccumulator()
        acc.record_page_content("https://example.com", "Long content " * 20)
        assert len(acc.page_contents) == 1
        assert acc.page_contents[0].url == "https://example.com"

    def test_record_page_content_ignores_short(self):
        acc = _OutputAccumulator()
        acc.record_page_content("https://example.com", "Hi")
        assert len(acc.page_contents) == 0

    def test_record_page_content_truncates(self):
        from app.services.browser_service import MAX_SINGLE_CONTENT_CHARS

        acc = _OutputAccumulator()
        acc.record_page_content("https://example.com", "X" * 50_000)
        assert len(acc.page_contents[0].content) == MAX_SINGLE_CONTENT_CHARS

    def test_record_page_content_respects_total_limit(self):
        from app.services.browser_service import MAX_TOTAL_CONTENT_CHARS

        acc = _OutputAccumulator()
        for i in range(15):
            acc.record_page_content(f"https://example.com/{i}", "Y" * 20_000)
        total = sum(len(pc.content) for pc in acc.page_contents)
        assert total <= MAX_TOTAL_CONTENT_CHARS + 20_000

    def test_record_token_usage_accumulates(self):
        acc = _OutputAccumulator()
        acc.record_token_usage(input_tokens=100, output_tokens=50)
        acc.record_token_usage(input_tokens=200, output_tokens=75, cost=0.01)
        assert acc.total_input_tokens == 300
        assert acc.total_output_tokens == 125
        assert acc.total_cost == 0.01

    def test_record_url_filters_assets(self):
        acc = _OutputAccumulator()
        acc.record_url("https://example.com/page")
        acc.record_url("https://cdn.example.com/image.png")
        acc.record_url("https://example.com/page")  # duplicate
        assert len(acc.seen_urls) == 1
        assert "https://example.com/page" in acc.seen_urls


# ---------------------------------------------------------------------------
# _fetch_single_page
# ---------------------------------------------------------------------------


class TestFetchSinglePage:
    @pytest.mark.asyncio
    async def test_fetches_page_content(self):
        page = _mock_page("https://example.com")
        page.inner_text = AsyncMock(return_value="Hello World content here")

        context = AsyncMock()
        context.new_page = AsyncMock(return_value=page)

        result = await _fetch_single_page(context, "https://example.com")

        assert result["url"] == "https://example.com"
        assert result["title"] == "Example Page"
        assert "Hello World" in result["content"]
        assert result["status"] == "200"
        page.close.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_truncates_long_content(self):
        from app.services.agent_loop import _MAX_FETCH_PAGE_CHARS

        page = _mock_page()
        page.inner_text = AsyncMock(return_value="X" * 20_000)

        context = AsyncMock()
        context.new_page = AsyncMock(return_value=page)

        result = await _fetch_single_page(context, "https://example.com")

        assert len(result["content"]) <= _MAX_FETCH_PAGE_CHARS + 20  # truncation marker
        assert result["content"].endswith("...(truncated)")

    @pytest.mark.asyncio
    async def test_handles_page_error(self):
        page = _mock_page()
        page.goto = AsyncMock(side_effect=TimeoutError("navigation timeout"))

        context = AsyncMock()
        context.new_page = AsyncMock(return_value=page)

        result = await _fetch_single_page(context, "https://slow.example.com")

        assert result["status"] == "error"
        assert "Error" in result["content"]
        page.close.assert_awaited_once()


# ---------------------------------------------------------------------------
# fetch_pages tool via _execute_tool
# ---------------------------------------------------------------------------


class TestFetchPagesTool:
    @pytest.mark.asyncio
    async def test_fetches_multiple_pages_in_parallel(self):
        pages = []
        for i in range(3):
            p = _mock_page(f"https://example.com/page{i}")
            p.inner_text = AsyncMock(return_value=f"Content of page {i}")
            pages.append(p)

        call_idx = 0

        async def mock_new_page():
            nonlocal call_idx
            page = pages[call_idx]
            call_idx += 1
            return page

        context = AsyncMock()
        context.new_page = AsyncMock(side_effect=mock_new_page)

        page = _mock_page()
        acc = _OutputAccumulator()

        result = await _execute_tool(
            page,
            "fetch_pages",
            {"urls": ["https://example.com/page0", "https://example.com/page1", "https://example.com/page2"]},
            acc,
            "/tmp",
            context=context,
        )

        assert "Content of page 0" in result
        assert "Content of page 1" in result
        assert "Content of page 2" in result
        assert acc.navigation_count == 3

    @pytest.mark.asyncio
    async def test_limits_to_max_parallel_pages(self):
        from app.services.agent_loop import _MAX_PARALLEL_PAGES

        pages_created = []

        async def mock_new_page():
            p = _mock_page()
            p.inner_text = AsyncMock(return_value="Page content here")
            pages_created.append(p)
            return p

        context = AsyncMock()
        context.new_page = AsyncMock(side_effect=mock_new_page)

        page = _mock_page()
        acc = _OutputAccumulator()

        urls = [f"https://example.com/{i}" for i in range(10)]
        await _execute_tool(page, "fetch_pages", {"urls": urls}, acc, "/tmp", context=context)

        assert len(pages_created) == _MAX_PARALLEL_PAGES

    @pytest.mark.asyncio
    async def test_records_urls_and_content(self):
        page_mock = _mock_page("https://news.example.com")
        page_mock.inner_text = AsyncMock(return_value="Breaking news content " * 10)

        context = AsyncMock()
        context.new_page = AsyncMock(return_value=page_mock)

        page = _mock_page()
        acc = _OutputAccumulator()

        await _execute_tool(
            page,
            "fetch_pages",
            {"urls": ["https://news.example.com"]},
            acc,
            "/tmp",
            context=context,
        )

        assert "https://news.example.com" in acc.seen_urls
        assert acc.has_page_content

    @pytest.mark.asyncio
    async def test_returns_error_without_context(self):
        page = _mock_page()
        acc = _OutputAccumulator()

        result = await _execute_tool(
            page,
            "fetch_pages",
            {"urls": ["https://example.com"]},
            acc,
            "/tmp",
        )

        assert "Error" in result

    @pytest.mark.asyncio
    async def test_returns_error_with_empty_urls(self):
        context = AsyncMock()
        page = _mock_page()
        acc = _OutputAccumulator()

        result = await _execute_tool(
            page,
            "fetch_pages",
            {"urls": []},
            acc,
            "/tmp",
            context=context,
        )

        assert "Error" in result

    @pytest.mark.asyncio
    async def test_integration_batched_navigates(self):
        """When LLM returns multiple navigate calls, they should be batched in parallel."""
        pages_created = []

        async def mock_new_page():
            p = _mock_page()
            p.inner_text = AsyncMock(return_value=f"Content of page {len(pages_created)}")
            pages_created.append(p)
            return p

        context = AsyncMock()
        context.new_page = AsyncMock(side_effect=mock_new_page)

        call_count = 0

        async def mock_llm(messages, tools, timeout):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return _make_llm_response(
                    tool_calls=[
                        _make_tool_call("navigate", {"url": "https://a.com"}, "call_1"),
                        _make_tool_call("navigate", {"url": "https://b.com"}, "call_2"),
                        _make_tool_call("navigate", {"url": "https://c.com"}, "call_3"),
                    ]
                )
            return _make_llm_response(content="Here is the combined answer.")

        with patch("app.services.agent_loop._call_llm_with_tools", side_effect=mock_llm):
            result = await run_agent_loop("Compare three sites", context, timeout_seconds=60)

        assert result["success"] is True
        assert "combined answer" in result["response"]
        # 1 page from run_agent_loop + 3 from parallel fetch
        assert len(pages_created) == 4

    @pytest.mark.asyncio
    async def test_partial_failure_still_returns_results(self):
        good_page = _mock_page("https://good.com")
        good_page.inner_text = AsyncMock(return_value="Good content here")

        bad_page = _mock_page("https://bad.com")
        bad_page.goto = AsyncMock(side_effect=TimeoutError("timeout"))

        call_idx = 0

        async def mock_new_page():
            nonlocal call_idx
            p = [good_page, bad_page][call_idx]
            call_idx += 1
            return p

        context = AsyncMock()
        context.new_page = AsyncMock(side_effect=mock_new_page)

        page = _mock_page()
        acc = _OutputAccumulator()

        result = await _execute_tool(
            page,
            "fetch_pages",
            {"urls": ["https://good.com", "https://bad.com"]},
            acc,
            "/tmp",
            context=context,
        )

        assert "Good content" in result
        assert "Error" in result

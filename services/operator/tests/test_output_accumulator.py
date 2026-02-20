"""Tests for _OutputAccumulator in browser_service."""

import json

import pytest

from app.services.browser_service import (
    _ASSET_URL_PATTERN,
    MAX_NAVIGATION_COUNT,
    MAX_SINGLE_CONTENT_CHARS,
    MAX_TOTAL_CONTENT_CHARS,
    _OutputAccumulator,
    _PageContent,
    _prepare_content_for_summarization,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_tool_use_line(urls: list[str]) -> str:
    """Build a JSONL line simulating a tool_use event with URLs."""
    return json.dumps({
        "type": "tool_use",
        "part": {
            "toolName": "playwright_browser_navigate",
            "args": {"url": urls[0] if urls else ""},
            "result": {"content": " ".join(urls)},
        },
    })


def _make_text_line(text: str) -> str:
    return json.dumps({"type": "text", "part": {"text": text}})


def _make_step_finish_line(
    cost: float = 0.01,
    input_tokens: int = 100,
    output_tokens: int = 50,
    reasoning_tokens: int = 10,
    cache_read: int = 20,
) -> str:
    return json.dumps({
        "type": "step_finish",
        "part": {
            "cost": cost,
            "tokens": {
                "input": input_tokens,
                "output": output_tokens,
                "reasoning": reasoning_tokens,
                "cache": {"read": cache_read},
            },
        },
    })


# ---------------------------------------------------------------------------
# URL extraction from tool_use events
# ---------------------------------------------------------------------------

class TestUrlExtractionFromToolUse:
    def test_extracts_urls_from_tool_use_events(self):
        acc = _OutputAccumulator()
        acc.process_line(_make_tool_use_line([
            "https://example.com/page",
            "https://another.com/article",
        ]))
        assert "https://example.com/page" in acc.seen_urls
        assert "https://another.com/article" in acc.seen_urls

    def test_filters_asset_urls(self):
        acc = _OutputAccumulator()
        acc.process_line(_make_tool_use_line([
            "https://example.com/page",
            "https://cdn.example.com/logo.png",
            "https://cdn.example.com/style.css",
            "https://cdn.example.com/font.woff2",
            "https://cdn.example.com/image.jpg?w=100",
            "https://cdn.example.com/photo.jpeg",
            "https://cdn.example.com/icon.svg",
            "https://cdn.example.com/icon.ico",
        ]))
        assert "https://example.com/page" in acc.seen_urls
        assert len(acc.seen_urls) == 1

    def test_deduplicates_urls(self):
        acc = _OutputAccumulator()
        acc.process_line(_make_tool_use_line(["https://example.com/page"]))
        acc.process_line(_make_tool_use_line(["https://example.com/page"]))
        assert len(acc.seen_urls) == 1

    def test_also_extracts_from_tool_result_events(self):
        acc = _OutputAccumulator()
        line = json.dumps({
            "type": "tool_result",
            "part": {"content": "Found at https://legacy.example.com/result"},
        })
        acc.process_line(line)
        assert "https://legacy.example.com/result" in acc.seen_urls

    def test_ignores_urls_from_non_tool_events(self):
        acc = _OutputAccumulator()
        line = json.dumps({
            "type": "step_start",
            "part": {"note": "see https://internal.example.com/debug"},
        })
        acc.process_line(line)
        assert len(acc.seen_urls) == 0


# ---------------------------------------------------------------------------
# Asset URL pattern
# ---------------------------------------------------------------------------

class TestAssetUrlPattern:
    @pytest.mark.parametrize("url", [
        "https://cdn.example.com/logo.png",
        "https://cdn.example.com/photo.jpg",
        "https://cdn.example.com/photo.jpeg",
        "https://cdn.example.com/anim.gif",
        "https://cdn.example.com/icon.svg",
        "https://cdn.example.com/photo.webp",
        "https://cdn.example.com/icon.ico",
        "https://cdn.example.com/style.css",
        "https://cdn.example.com/app.js",
        "https://cdn.example.com/font.woff",
        "https://cdn.example.com/font.woff2",
        "https://cdn.example.com/font.ttf",
        "https://cdn.example.com/font.eot",
        "https://cdn.example.com/video.mp4",
        "https://cdn.example.com/image.png?w=100&h=200",
        "https://cdn.example.com/image.jpg#section",
    ])
    def test_matches_asset_urls(self, url):
        assert _ASSET_URL_PATTERN.search(url), f"Should match: {url}"

    @pytest.mark.parametrize("url", [
        "https://example.com/page",
        "https://example.com/products/stroller",
        "https://google.com/search?q=test",
        "https://example.com/api/v1/data.json",  # .json is NOT an asset
        "https://example.com/about",
        "https://example.com/blog/post-1",
    ])
    def test_does_not_match_page_urls(self, url):
        assert not _ASSET_URL_PATTERN.search(url), f"Should NOT match: {url}"


# ---------------------------------------------------------------------------
# to_response: timeout with no text, no URLs
# ---------------------------------------------------------------------------

class TestToResponseTimeoutNoData:
    def test_returns_failure_with_generic_message(self):
        acc = _OutputAccumulator()
        result = acc.to_response(270.0, timed_out=True)
        assert result["success"] is False
        assert result["partial"] is False
        assert "could not be completed" in result["response"]
        assert result["sources"] == []


# ---------------------------------------------------------------------------
# to_response: timeout with URLs but no text
# ---------------------------------------------------------------------------

class TestToResponseTimeoutWithUrls:
    def test_returns_partial_success_with_sources(self):
        acc = _OutputAccumulator()
        acc.process_line(_make_tool_use_line(["https://example.com/page1"]))
        acc.process_line(_make_tool_use_line(["https://example.com/page2"]))
        result = acc.to_response(270.0, timed_out=True)
        assert result["success"] is True
        assert result["partial"] is True
        assert "https://example.com/page1" in result["response"]
        assert "https://example.com/page2" in result["response"]
        assert "sources were visited" in result["response"]
        assert len(result["sources"]) == 2

    def test_truncates_url_list_at_25(self):
        acc = _OutputAccumulator()
        for i in range(30):
            acc.process_line(_make_tool_use_line([f"https://example.com/page{i}"]))
        result = acc.to_response(270.0, timed_out=True)
        assert result["success"] is True
        assert result["partial"] is True
        assert "... and 5 more" in result["response"]
        assert len(result["sources"]) == 30


# ---------------------------------------------------------------------------
# to_response: timeout with text (partial text)
# ---------------------------------------------------------------------------

class TestToResponseTimeoutWithText:
    def test_returns_partial_success_with_incomplete_note(self):
        acc = _OutputAccumulator()
        acc.process_line(_make_text_line("Here are some findings:"))
        result = acc.to_response(270.0, timed_out=True)
        assert result["success"] is True
        assert result["partial"] is True
        assert "Here are some findings:" in result["response"]
        assert "may be incomplete" in result["response"]


# ---------------------------------------------------------------------------
# to_response: no timeout (normal completion)
# ---------------------------------------------------------------------------

class TestToResponseNormalCompletion:
    def test_returns_full_success(self):
        acc = _OutputAccumulator()
        acc.process_line(_make_text_line("Full response text."))
        acc.process_line(_make_tool_use_line(["https://source.com/article"]))
        result = acc.to_response(120.0, timed_out=False)
        assert result["success"] is True
        assert result["partial"] is False
        assert result["response"] == "Full response text."
        assert "https://source.com/article" in result["sources"]

    def test_includes_token_usage(self):
        acc = _OutputAccumulator()
        acc.process_line(_make_text_line("Done."))
        acc.process_line(_make_step_finish_line(
            cost=0.05,
            input_tokens=200,
            output_tokens=100,
            reasoning_tokens=30,
            cache_read=50,
        ))
        result = acc.to_response(60.0, timed_out=False)
        assert result["token_usage"]["input_tokens"] == 200
        assert result["token_usage"]["output_tokens"] == 130  # 100 + 30 reasoning
        assert result["cost_usd"] == 0.05


# ---------------------------------------------------------------------------
# process_line: edge cases
# ---------------------------------------------------------------------------

class TestProcessLineEdgeCases:
    def test_ignores_empty_lines(self):
        acc = _OutputAccumulator()
        acc.process_line("")
        acc.process_line("   ")
        assert len(acc.event_types_seen) == 0

    def test_ignores_invalid_json(self):
        acc = _OutputAccumulator()
        acc.process_line("not json at all")
        assert len(acc.event_types_seen) == 0

    def test_tracks_event_types(self):
        acc = _OutputAccumulator()
        acc.process_line(_make_text_line("hello"))
        acc.process_line(_make_step_finish_line())
        acc.process_line(_make_tool_use_line(["https://example.com"]))
        assert acc.event_types_seen == {"text", "step_finish", "tool_use"}


# ---------------------------------------------------------------------------
# Helpers for page content tests
# ---------------------------------------------------------------------------

def _make_tool_result_line(content: str | list[dict]) -> str:
    return json.dumps({
        "type": "tool_result",
        "part": {"content": content},
    })


def _make_navigate_tool_use_line(url: str) -> str:
    return json.dumps({
        "type": "tool_use",
        "part": {
            "toolName": "playwright_browser_navigate",
            "args": {"url": url},
        },
    })


# ---------------------------------------------------------------------------
# Page content capture
# ---------------------------------------------------------------------------

class TestPageContentCapture:
    def test_captures_string_content(self):
        acc = _OutputAccumulator()
        acc.process_line(_make_tool_result_line("A" * 100))
        assert len(acc.page_contents) == 1
        assert acc.page_contents[0].content == "A" * 100

    def test_captures_list_of_blocks_content(self):
        acc = _OutputAccumulator()
        acc.process_line(_make_tool_result_line([
            {"type": "text", "text": "Block one content " * 5},
            {"type": "text", "text": "Block two content " * 5},
        ]))
        assert len(acc.page_contents) == 1
        assert "Block one" in acc.page_contents[0].content
        assert "Block two" in acc.page_contents[0].content

    def test_ignores_short_content(self):
        acc = _OutputAccumulator()
        acc.process_line(_make_tool_result_line("OK"))
        assert len(acc.page_contents) == 0

    def test_associates_url_from_prior_navigate(self):
        acc = _OutputAccumulator()
        acc.process_line(_make_navigate_tool_use_line("https://example.com/article"))
        acc.process_line(_make_tool_result_line("Page content here " * 10))
        assert acc.page_contents[0].url == "https://example.com/article"

    def test_unknown_url_when_no_navigate(self):
        acc = _OutputAccumulator()
        acc.process_line(_make_tool_result_line("Content without navigation " * 5))
        assert acc.page_contents[0].url == "unknown"

    def test_truncates_single_content(self):
        acc = _OutputAccumulator()
        acc.process_line(_make_tool_result_line("X" * 50_000))
        assert len(acc.page_contents[0].content) == MAX_SINGLE_CONTENT_CHARS

    def test_stops_accumulating_at_total_limit(self):
        acc = _OutputAccumulator()
        for i in range(15):
            acc.process_line(_make_navigate_tool_use_line(f"https://example.com/page{i}"))
            acc.process_line(_make_tool_result_line("Y" * 20_000))
        total_chars = sum(len(pc.content) for pc in acc.page_contents)
        assert total_chars <= MAX_TOTAL_CONTENT_CHARS + MAX_SINGLE_CONTENT_CHARS

    def test_has_page_content_property(self):
        acc = _OutputAccumulator()
        assert not acc.has_page_content
        acc.process_line(_make_tool_result_line("Substantial content " * 10))
        assert acc.has_page_content


# ---------------------------------------------------------------------------
# Navigation budget
# ---------------------------------------------------------------------------

class TestNavigationBudget:
    def test_counts_navigations(self):
        acc = _OutputAccumulator()
        for i in range(5):
            acc.process_line(_make_navigate_tool_use_line(f"https://example.com/page{i}"))
        assert acc.navigation_count == 5
        assert not acc.should_terminate

    def test_terminates_at_max(self):
        acc = _OutputAccumulator()
        for i in range(MAX_NAVIGATION_COUNT):
            acc.process_line(_make_navigate_tool_use_line(f"https://example.com/page{i}"))
        assert acc.navigation_count == MAX_NAVIGATION_COUNT
        assert acc.should_terminate

    def test_does_not_terminate_below_max(self):
        acc = _OutputAccumulator()
        for i in range(MAX_NAVIGATION_COUNT - 1):
            acc.process_line(_make_navigate_tool_use_line(f"https://example.com/page{i}"))
        assert not acc.should_terminate

    def test_non_navigate_tools_not_counted(self):
        acc = _OutputAccumulator()
        snapshot_line = json.dumps({
            "type": "tool_use",
            "part": {
                "toolName": "playwright_browser_snapshot",
                "args": {},
            },
        })
        click_line = json.dumps({
            "type": "tool_use",
            "part": {
                "toolName": "playwright_browser_click",
                "args": {"ref": "btn1"},
            },
        })
        acc.process_line(snapshot_line)
        acc.process_line(click_line)
        assert acc.navigation_count == 0

    def test_navigate_without_url_not_counted(self):
        acc = _OutputAccumulator()
        line = json.dumps({
            "type": "tool_use",
            "part": {
                "toolName": "playwright_browser_navigate",
                "args": {"url": ""},
            },
        })
        acc.process_line(line)
        assert acc.navigation_count == 0


# ---------------------------------------------------------------------------
# to_response: Phase 2 summarized note
# ---------------------------------------------------------------------------

class TestToResponsePhase2:
    def test_phase2_summarized_has_distinct_note(self):
        acc = _OutputAccumulator()
        acc.text_parts.append("Summary from Phase 2.")
        acc.phase2_summarized = True
        result = acc.to_response(300.0, timed_out=True)
        assert "auto-generated" in result["response"]
        assert "may be incomplete" not in result["response"]

    def test_non_phase2_timeout_has_standard_note(self):
        acc = _OutputAccumulator()
        acc.text_parts.append("Partial text from Phase 1.")
        result = acc.to_response(270.0, timed_out=True)
        assert "may be incomplete" in result["response"]
        assert "auto-generated" not in result["response"]


# ---------------------------------------------------------------------------
# to_response: nav_terminated semantics
# ---------------------------------------------------------------------------

class TestToResponseNavTerminated:
    def test_nav_terminated_no_data_mentions_navigation_limit(self):
        acc = _OutputAccumulator()
        result = acc.to_response(60.0, nav_terminated=True)
        assert result["success"] is False
        assert result["partial"] is False
        assert "navigation limit" in result["response"]
        assert "time limit" not in result["response"]

    def test_nav_terminated_with_urls_mentions_navigation_limit(self):
        acc = _OutputAccumulator()
        acc.process_line(_make_tool_use_line(["https://example.com/page1"]))
        result = acc.to_response(60.0, nav_terminated=True)
        assert result["success"] is True
        assert result["partial"] is True
        assert "navigation limit" in result["response"]
        assert "time limit" not in result["response"]

    def test_nav_terminated_with_text_has_navigation_note(self):
        acc = _OutputAccumulator()
        acc.process_line(_make_text_line("Partial findings."))
        result = acc.to_response(60.0, nav_terminated=True)
        assert result["success"] is True
        assert result["partial"] is True
        assert "navigation limit" in result["response"]
        assert "time limit" not in result["response"]

    def test_nav_terminated_phase2_mentions_navigation_limit(self):
        acc = _OutputAccumulator()
        acc.text_parts.append("Summary from Phase 2.")
        acc.phase2_summarized = True
        result = acc.to_response(60.0, nav_terminated=True)
        assert "navigation limit" in result["response"]
        assert "auto-generated" in result["response"]

    def test_timeout_messages_unchanged(self):
        acc = _OutputAccumulator()
        result = acc.to_response(270.0, timed_out=True)
        assert "time limit" in result["response"]
        assert "navigation limit" not in result["response"]


# ---------------------------------------------------------------------------
# _prepare_content_for_summarization
# ---------------------------------------------------------------------------

class TestPrepareContentForSummarization:
    def test_deduplicates_by_url_keeps_latest(self):
        contents = [
            _PageContent(url="https://example.com", content="Old version " * 10),
            _PageContent(url="https://example.com", content="New version " * 10),
        ]
        result = _prepare_content_for_summarization(contents)
        assert "New version" in result
        assert "Old version" not in result

    def test_includes_url_headers(self):
        contents = [
            _PageContent(url="https://example.com/article", content="Article text " * 10),
        ]
        result = _prepare_content_for_summarization(contents)
        assert "https://example.com/article" in result

    def test_respects_budget(self):
        contents = [
            _PageContent(url=f"https://example.com/{i}", content="Z" * 50_000)
            for i in range(10)
        ]
        result = _prepare_content_for_summarization(contents)
        # Should be bounded (DIRECT_SUMMARIZE_THRESHOLD_CHARS * 2 + overhead)
        assert len(result) < 100_000

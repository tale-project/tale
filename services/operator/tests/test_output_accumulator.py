"""Tests for _OutputAccumulator in browser_service."""

import json

import pytest

from app.services.browser_service import _OutputAccumulator, _ASSET_URL_PATTERN


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

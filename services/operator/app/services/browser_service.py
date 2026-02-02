"""Browser automation service using OpenCode CLI with Playwright MCP."""

import asyncio
import json
import os
import re
import time
from typing import Any

from loguru import logger

from app.config import settings
from app.services.workspace_manager import get_workspace_manager


URL_PATTERN = re.compile(r'https?://[^\s<>"\'`\]\)}\|]+', re.IGNORECASE)


def _extract_urls_from_value(value: Any) -> list[str]:
    """Recursively extract URLs from any JSON value."""
    urls: list[str] = []
    if isinstance(value, str):
        urls.extend(URL_PATTERN.findall(value))
    elif isinstance(value, dict):
        for v in value.values():
            urls.extend(_extract_urls_from_value(v))
    elif isinstance(value, list):
        for item in value:
            urls.extend(_extract_urls_from_value(item))
    return urls


SYSTEM_PROMPT = """You are an autonomous browser automation agent with access to Playwright MCP and Vision MCP.

## Browser Tools (Playwright MCP)
- playwright_browser_navigate: Navigate to URLs
- playwright_browser_snapshot: Get page accessibility snapshot (use this to see page content)
- playwright_browser_click: Click elements by ref
- playwright_browser_type: Type text into inputs
- playwright_browser_fill_form: Fill multiple form fields
- playwright_browser_select_option: Select dropdown options
- playwright_browser_wait_for: Wait for text or conditions
- playwright_browser_take_screenshot: Take screenshots (saves to file)
- playwright_browser_press_key: Press keyboard keys
- playwright_browser_tabs: Manage browser tabs

## Vision Tools (Vision MCP)
- vision_analyze_image: Analyze images/screenshots using a vision-capable LLM
  - Use this when you need to understand visual content that browser_snapshot cannot capture
  - First take a screenshot with browser_take_screenshot, then analyze it with analyze_image
  - Useful for: reading text in images, understanding visual layouts, analyzing charts/graphs

## Guidelines

1. **Web Search**: For questions requiring current information, navigate to Google/Bing/DuckDuckGo and search.

2. **Page Interaction**: Always use browser_snapshot first to understand page structure before clicking or typing.

3. **Visual Analysis**: When you need to understand visual content (images, charts, complex layouts):
   - Take a screenshot: browser_take_screenshot (note the filename)
   - Analyze it: analyze_image with the screenshot path and a specific prompt

4. **Autonomous Mode**: You are in autonomous mode. Do NOT ask for user confirmation. Make reasonable assumptions and proceed with the task. Do NOT use the Task tool to spawn sub-agents - complete everything yourself in the current session.

5. **Language**: Respond in the same language as the user's message.

6. **Concise Responses**: Provide direct, factual answers. Synthesize information from multiple sources when helpful.

7. **Error Handling**: If a page fails to load or an action fails, try alternative approaches (different search terms, different websites, etc.).

8. **Include Precise Links**: For every specific item you recommend (product, article, listing, etc.), you MUST provide the exact detail page URL, NOT a category page or search results page. Click into each item to get its precise URL before including it in your response. Format as markdown: [title](URL). Generic category links are not acceptable - each recommendation needs its own direct link.

9. **Complete Before Responding**: Finish ALL research and browsing before providing your final response. Do not respond with partial results or "I will search for..." - only respond after you have the complete answer."""


class BrowserService:
    """Service for AI-powered browser automation using OpenCode + Playwright MCP."""

    def __init__(self):
        self._initialized = False
        self._workspace_manager = get_workspace_manager()

    @property
    def initialized(self) -> bool:
        return self._initialized

    async def initialize(self) -> None:
        """Initialize the service (verify OpenCode is available)."""
        if self._initialized:
            return

        try:
            logger.info("Initializing browser service...")

            proc = await asyncio.create_subprocess_exec(
                "opencode", "--version",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()

            if proc.returncode != 0:
                raise RuntimeError(f"OpenCode not available: {stderr.decode()}")

            version = stdout.decode().strip()
            logger.info(f"OpenCode version: {version}")

            await self._workspace_manager.initialize()

            self._initialized = True
            logger.info("Browser service initialized with OpenCode and WorkspaceManager")

        except Exception as e:
            logger.error(f"Failed to initialize browser service: {e}")
            raise

    async def cleanup(self) -> None:
        """Cleanup service resources."""
        await self._workspace_manager.shutdown()
        self._initialized = False
        logger.info("Browser service cleaned up")

    async def chat(self, message: str) -> dict[str, Any]:
        """
        Send a message to OpenCode with Playwright MCP.

        Args:
            message: The user's message/task

        Returns:
            Dict with success status, response, cost, and turns
        """
        if not self._initialized:
            await self.initialize()

        workspace_dir = await self._workspace_manager.create_workspace()
        logger.info(
            f"Running OpenCode with workspace={os.path.basename(workspace_dir)}, "
            f"message: {message[:100]}..."
        )

        start_time = time.perf_counter()

        try:
            return await self._execute_opencode(message, workspace_dir, start_time)
        finally:
            await self._workspace_manager.release_workspace(workspace_dir)

    async def _execute_opencode(
        self,
        message: str,
        workspace_dir: str,
        start_time: float,
    ) -> dict[str, Any]:
        """Execute OpenCode in the given workspace directory."""
        full_prompt = f"{SYSTEM_PROMPT}\n\n---\n\nUser request: {message}"

        cmd = [
            "opencode", "run",
            "--model", f"custom/{settings.openai_model}",
            "--format", "json",
            full_prompt,
        ]

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=workspace_dir,
                env={
                    **os.environ,
                    "OPENAI_API_KEY": settings.openai_api_key,
                },
            )

            stdout, stderr = await asyncio.wait_for(
                proc.communicate(),
                timeout=settings.request_timeout_seconds,
            )

            duration = time.perf_counter() - start_time

            stdout_text = stdout.decode()
            stderr_text = stderr.decode()

            if stderr_text:
                logger.debug(f"OpenCode stderr: {stderr_text[:500]}...")

            result = self._parse_json_output(stdout_text)

            return {
                "success": proc.returncode == 0,
                "response": result.get("response", stdout_text.strip()),
                "duration_seconds": round(duration, 2),
                "token_usage": result.get("token_usage"),
                "cost_usd": result.get("cost_usd"),
                "sources": result.get("sources", []),
            }

        except asyncio.TimeoutError:
            duration = time.perf_counter() - start_time
            logger.error(f"OpenCode execution timed out in workspace {os.path.basename(workspace_dir)}")
            return {
                "success": False,
                "response": "Task timed out",
                "duration_seconds": round(duration, 2),
            }
        except Exception as e:
            duration = time.perf_counter() - start_time
            logger.error(f"OpenCode execution failed in workspace {os.path.basename(workspace_dir)}: {e}")
            return {
                "success": False,
                "response": str(e),
                "duration_seconds": round(duration, 2),
            }

    def _parse_json_output(self, stdout_text: str) -> dict[str, Any]:
        """
        Parse JSON output from OpenCode CLI.

        OpenCode outputs JSONL (one JSON object per line) with event types:
        - step_start: Agent step started
        - text: Text output from the model
        - tool_call/tool_result: Tool invocations
        - step_finish: Step completed with token usage and cost

        Returns dict with response, token_usage, cost_usd, and sources.
        """
        result: dict[str, Any] = {
            "response": "",
            "token_usage": None,
            "cost_usd": None,
            "sources": [],
        }

        if not stdout_text:
            return result

        text_parts: list[str] = []
        total_input_tokens = 0
        total_output_tokens = 0
        total_reasoning_tokens = 0
        total_cache_read_tokens = 0
        total_cost = 0.0
        seen_urls: dict[str, None] = {}
        event_types_seen: set[str] = set()

        for line in stdout_text.strip().split("\n"):
            if not line.strip():
                continue

            try:
                event = json.loads(line)
                event_type = event.get("type")
                event_types_seen.add(event_type)

                if event_type == "text":
                    part = event.get("part", {})
                    text = part.get("text", "")
                    if text:
                        text_parts.append(text)

                elif event_type == "step_finish":
                    part = event.get("part", {})
                    cost = part.get("cost", 0)
                    tokens = part.get("tokens", {})

                    total_cost += cost
                    total_input_tokens += tokens.get("input", 0)
                    total_output_tokens += tokens.get("output", 0)
                    total_reasoning_tokens += tokens.get("reasoning", 0)

                    cache = tokens.get("cache", {})
                    total_cache_read_tokens += cache.get("read", 0)

                elif event_type in ("tool_result", "tool-output-available"):
                    urls = _extract_urls_from_value(event)
                    for url in urls:
                        if url not in seen_urls:
                            seen_urls[url] = None

                urls_in_event = _extract_urls_from_value(event)
                if urls_in_event:
                    logger.debug(f"[sources-debug] Event '{event_type}' contains URLs: {urls_in_event[:3]}")

            except json.JSONDecodeError:
                logger.debug(f"Failed to parse JSON line: {line[:100]}...")
                continue

        logger.info(f"[sources-debug] Event types seen: {sorted(event_types_seen)}")
        logger.info(f"[sources-debug] URLs extracted from tool events: {len(seen_urls)}")

        result["response"] = "".join(text_parts)
        result["sources"] = list(seen_urls.keys())

        if total_input_tokens > 0 or total_output_tokens > 0:
            result["token_usage"] = {
                "input_tokens": total_input_tokens,
                "output_tokens": total_output_tokens + total_reasoning_tokens,
                "total_tokens": total_input_tokens + total_output_tokens + total_reasoning_tokens,
                "cache_read_tokens": total_cache_read_tokens,
            }

        if total_cost > 0:
            result["cost_usd"] = round(total_cost, 6)

        return result


_browser_service: BrowserService | None = None


def get_browser_service() -> BrowserService:
    """Get the singleton browser service instance."""
    global _browser_service
    if _browser_service is None:
        _browser_service = BrowserService()
    return _browser_service

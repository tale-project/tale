"""Browser automation service using OpenCode CLI with Playwright MCP."""

import asyncio
import contextlib
import json
import os
import re
import signal
import time
from dataclasses import dataclass, field
from typing import Any

from loguru import logger

from app.config import settings
from app.services.workspace_manager import get_workspace_manager

URL_PATTERN = re.compile(r'https?://[^\s<>"\'`\]\)}\|]+', re.IGNORECASE)

_ASSET_URL_PATTERN = re.compile(
    r'\.(png|jpe?g|gif|svg|webp|ico|css|js|woff2?|ttf|eot|mp[34]|avi|mov)([?#&]|$)',
    re.IGNORECASE,
)

GRACEFUL_SHUTDOWN_SECONDS = 10
HARD_KILL_SECONDS = 5


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

4. **Autonomous Mode**: You are in autonomous mode. Do NOT ask for user confirmation.
   Make reasonable assumptions and proceed with the task.
   Do NOT use the Task tool to spawn sub-agents - complete everything yourself in the current session.

5. **Language**: Respond in the same language as the user's message.

6. **Concise Responses**: Provide direct, factual answers. Synthesize information from multiple sources when helpful.

7. **Error Handling**: If a page fails to load or an action fails,
   try alternative approaches (different search terms, different websites, etc.).

8. **Include Precise Links**: For every specific item you recommend
   (product, article, listing, etc.), you MUST provide the exact detail page URL,
   NOT a category page or search results page.
   Click into each item to get its precise URL before including it in your response.
   Format as markdown: [title](URL).
   Generic category links are not acceptable - each recommendation needs its own direct link.

9. **Time Management**: You have a LIMITED time budget of about 4 minutes. Work efficiently:
   - Prioritize the most important information first.
   - Do NOT spend excessive time on a single source — if a page is slow or unhelpful, move on.
   - For complex tasks, focus on gathering the key findings rather than exhaustive coverage.
   - If a task has multiple parts, address the most critical parts first.
   - **CRITICAL**: After visiting 2-3 key sources, START writing your response immediately.
     Continue researching and append to your response as you find more information.
     Do NOT wait until all research is complete to begin writing.
   - Provide the best answer you can with the information you have gathered."""


@dataclass
class _OutputAccumulator:
    """Progressively accumulates parsed JSONL output from OpenCode."""

    text_parts: list[str] = field(default_factory=list)
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_reasoning_tokens: int = 0
    total_cache_read_tokens: int = 0
    total_cost: float = 0.0
    seen_urls: dict[str, None] = field(default_factory=dict)
    event_types_seen: set[str] = field(default_factory=set)

    def process_line(self, line: str) -> None:
        """Parse and accumulate a single JSONL line."""
        line = line.strip()
        if not line:
            return

        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            logger.debug(f"Failed to parse JSON line: {line[:100]}...")
            return

        event_type = event.get("type")
        self.event_types_seen.add(event_type)

        if event_type == "text":
            part = event.get("part", {})
            text = part.get("text", "")
            if text:
                self.text_parts.append(text)

        elif event_type == "step_finish":
            part = event.get("part", {})
            self.total_cost += part.get("cost", 0)
            tokens = part.get("tokens", {})
            self.total_input_tokens += tokens.get("input", 0)
            self.total_output_tokens += tokens.get("output", 0)
            self.total_reasoning_tokens += tokens.get("reasoning", 0)
            cache = tokens.get("cache", {})
            self.total_cache_read_tokens += cache.get("read", 0)

        if event_type in ("tool_use", "tool_result", "tool-output-available"):
            for url in _extract_urls_from_value(event):
                if url not in self.seen_urls and not _ASSET_URL_PATTERN.search(url):
                    self.seen_urls[url] = None

    def to_response(self, duration: float, *, timed_out: bool) -> dict[str, Any]:
        """Build the final response dict from accumulated data."""
        logger.info(
            f"Event types seen: {sorted(self.event_types_seen)}, "
            f"text_parts={len(self.text_parts)}, "
            f"urls_collected={len(self.seen_urls)}"
        )

        response_text = "".join(self.text_parts)
        has_partial_data = bool(self.text_parts) or bool(self.seen_urls)

        if timed_out and not response_text:
            if self.seen_urls:
                source_list = list(self.seen_urls.keys())[:25]
                lines = [
                    "The research task reached its time limit before generating "
                    "a full summary. The following sources were visited during "
                    "research:",
                    "",
                ]
                lines.extend(f"- {url}" for url in source_list)
                remaining = len(self.seen_urls) - 25
                if remaining > 0:
                    lines.append(f"- ... and {remaining} more")
                response_text = "\n".join(lines)
            else:
                response_text = (
                    "The task could not be completed within the time limit. "
                    "No results were gathered. "
                    "Please try a simpler or more specific request."
                )
        elif timed_out and response_text:
            response_text += (
                "\n\n---\n*Note: This response may be incomplete as the task "
                "reached its time limit.*"
            )

        result: dict[str, Any] = {
            "success": not timed_out or has_partial_data,
            "partial": timed_out and has_partial_data,
            "response": response_text,
            "duration_seconds": round(duration, 2),
            "sources": list(self.seen_urls.keys()),
        }

        total_out = self.total_output_tokens + self.total_reasoning_tokens
        if self.total_input_tokens > 0 or total_out > 0:
            result["token_usage"] = {
                "input_tokens": self.total_input_tokens,
                "output_tokens": total_out,
                "total_tokens": self.total_input_tokens + total_out,
                "cache_read_tokens": self.total_cache_read_tokens,
            }

        if self.total_cost > 0:
            result["cost_usd"] = round(self.total_cost, 6)

        return result


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
                "opencode",
                "--version",
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

    async def chat(
        self,
        message: str,
        timeout_seconds: int | None = None,
    ) -> dict[str, Any]:
        """
        Send a message to OpenCode with Playwright MCP.

        Args:
            message: The user's message/task
            timeout_seconds: Client-requested timeout (seconds). Falls back to
                             settings.request_timeout_seconds if not provided.

        Returns:
            Dict with success status, response, cost, and turns
        """
        if not self._initialized:
            await self.initialize()

        workspace_dir = await self._workspace_manager.create_workspace()
        logger.info(
            f"Running OpenCode with workspace={os.path.basename(workspace_dir)}, "
            f"timeout={timeout_seconds or settings.request_timeout_seconds}s, "
            f"message: {message[:100]}..."
        )

        start_time = time.perf_counter()

        try:
            return await self._execute_opencode(
                message, workspace_dir, start_time, timeout_seconds
            )
        finally:
            await self._workspace_manager.release_workspace(workspace_dir)

    async def _execute_opencode(
        self,
        message: str,
        workspace_dir: str,
        start_time: float,
        timeout_seconds: int | None = None,
    ) -> dict[str, Any]:
        """
        Execute OpenCode with streaming output parsing and graceful timeout.

        Reads stdout line-by-line so partial results are preserved on timeout.
        On timeout: SIGTERM → wait → SIGKILL → return accumulated results.
        """
        full_prompt = f"{SYSTEM_PROMPT}\n\n---\n\nUser request: {message}"

        cmd = [
            "opencode",
            "run",
            "--model",
            f"custom/{settings.openai_coding_model}",
            "--format",
            "json",
            full_prompt,
        ]

        effective_timeout = min(
            timeout_seconds or settings.request_timeout_seconds,
            settings.request_timeout_seconds,
        )

        accumulator = _OutputAccumulator()

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

            stderr_parts: list[bytes] = []

            async def _drain_stderr() -> None:
                assert proc.stderr is not None
                async for line in proc.stderr:
                    stderr_parts.append(line)

            stderr_task = asyncio.create_task(_drain_stderr())

            timed_out = False
            try:
                assert proc.stdout is not None
                async with asyncio.timeout(effective_timeout):
                    async for raw_line in proc.stdout:
                        accumulator.process_line(raw_line.decode())
            except TimeoutError:
                timed_out = True
                logger.warning(
                    f"Timeout ({effective_timeout}s) reached in workspace "
                    f"{os.path.basename(workspace_dir)}, terminating OpenCode "
                    f"(accumulated {len(accumulator.text_parts)} text parts)"
                )
                await self._terminate_process(proc)

            stderr_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await stderr_task

            stderr_text = b"".join(stderr_parts).decode()
            if stderr_text:
                logger.debug(f"OpenCode stderr: {stderr_text[:500]}...")

            duration = time.perf_counter() - start_time
            return accumulator.to_response(duration, timed_out=timed_out)

        except Exception as e:
            duration = time.perf_counter() - start_time
            logger.error(
                f"OpenCode execution failed in workspace "
                f"{os.path.basename(workspace_dir)}: {e}"
            )
            return {
                "success": False,
                "partial": False,
                "response": str(e),
                "duration_seconds": round(duration, 2),
            }

    @staticmethod
    async def _terminate_process(proc: asyncio.subprocess.Process) -> None:
        """Gracefully terminate a subprocess: SIGTERM → wait → SIGKILL."""
        try:
            proc.send_signal(signal.SIGTERM)
            await asyncio.wait_for(proc.wait(), timeout=GRACEFUL_SHUTDOWN_SECONDS)
            logger.debug("OpenCode exited after SIGTERM")
        except TimeoutError:
            logger.warning("OpenCode did not exit after SIGTERM, sending SIGKILL")
            proc.kill()
            try:
                await asyncio.wait_for(proc.wait(), timeout=HARD_KILL_SECONDS)
            except TimeoutError:
                logger.error("OpenCode process did not exit after SIGKILL")
        except ProcessLookupError:
            pass


_browser_service: BrowserService | None = None


def get_browser_service() -> BrowserService:
    """Get the singleton browser service instance."""
    global _browser_service
    if _browser_service is None:
        _browser_service = BrowserService()
    return _browser_service

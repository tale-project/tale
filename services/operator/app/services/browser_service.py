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

import httpx
from loguru import logger

from app.config import settings
from app.services.workspace_manager import get_workspace_manager

URL_PATTERN = re.compile(r'https?://[^\s<>"\'`\]\)}\|]+', re.IGNORECASE)

_ASSET_URL_PATTERN = re.compile(
    r"\.(png|jpe?g|gif|svg|webp|ico|css|js|woff2?|ttf|eot|mp[34]|avi|mov)([?#&]|$)",
    re.IGNORECASE,
)

GRACEFUL_SHUTDOWN_SECONDS = 10
HARD_KILL_SECONDS = 5

# Phase 2: page content capture limits
MAX_TOTAL_CONTENT_CHARS = 200_000
MAX_SINGLE_CONTENT_CHARS = 30_000
MIN_CONTENT_LENGTH = 50

# Phase 2: summarization constants
PHASE2_MAP_TIMEOUT_SECONDS = 25
PHASE2_REDUCE_TIMEOUT_SECONDS = 20
MAP_CHUNK_CHARS = 20_000
DIRECT_SUMMARIZE_THRESHOLD_CHARS = 40_000

# Navigation budget: hard limit to prevent endless browsing
MAX_NAVIGATION_COUNT = 15


@dataclass
class _PageContent:
    url: str
    content: str


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

9. **Time Management**: You have a LIMITED time budget of about 3 minutes. Work efficiently:
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
    page_contents: list[_PageContent] = field(default_factory=list)
    phase2_summarized: bool = False
    navigation_count: int = 0
    _total_content_chars: int = 0
    _last_navigated_url: str = ""

    @property
    def has_page_content(self) -> bool:
        return bool(self.page_contents)

    @property
    def should_terminate(self) -> bool:
        return self.navigation_count >= MAX_NAVIGATION_COUNT

    def _extract_text_content(self, part: dict[str, Any]) -> str | None:
        """Extract text from a tool_result part, handling various structures."""
        content = part.get("content")
        if isinstance(content, str) and len(content) >= MIN_CONTENT_LENGTH:
            return content[:MAX_SINGLE_CONTENT_CHARS]
        if isinstance(content, list):
            texts = []
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    texts.append(block.get("text", ""))
            combined = "\n".join(texts)
            if len(combined) >= MIN_CONTENT_LENGTH:
                return combined[:MAX_SINGLE_CONTENT_CHARS]
        return None

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

        # Track navigations for page content association and budget enforcement
        if event_type == "tool_use":
            part = event.get("part", {})
            if part.get("toolName") == "playwright_browser_navigate":
                args = part.get("args", {})
                url = args.get("url", "")
                if url:
                    self._last_navigated_url = url
                    self.navigation_count += 1

        # Capture page content from tool results
        if event_type == "tool_result" and self._total_content_chars < MAX_TOTAL_CONTENT_CHARS:
            part = event.get("part", {})
            text_content = self._extract_text_content(part)
            if text_content:
                self.page_contents.append(
                    _PageContent(
                        url=self._last_navigated_url or "unknown",
                        content=text_content,
                    )
                )
                self._total_content_chars += len(text_content)
            else:
                logger.debug(f"Unparsed tool_result: keys={list(part.keys())}, preview={str(part)[:200]}")

    def to_response(self, duration: float, *, timed_out: bool) -> dict[str, Any]:
        """Build the final response dict from accumulated data."""
        logger.info(
            f"Event types seen: {sorted(self.event_types_seen)}, "
            f"text_parts={len(self.text_parts)}, "
            f"urls_collected={len(self.seen_urls)}, "
            f"page_contents={len(self.page_contents)}"
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
            if self.phase2_summarized:
                response_text += (
                    "\n\n---\n*Note: This summary was auto-generated from "
                    "collected page content after the browsing phase reached "
                    "its time limit.*"
                )
            else:
                response_text += "\n\n---\n*Note: This response may be incomplete as the task reached its time limit.*"

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


def _prepare_content_for_summarization(page_contents: list[_PageContent]) -> str:
    """Deduplicate and format page content for the summarization prompt."""
    seen_urls: dict[str, _PageContent] = {}
    for pc in page_contents:
        seen_urls[pc.url] = pc

    sections: list[str] = []
    remaining = DIRECT_SUMMARIZE_THRESHOLD_CHARS * 2
    for pc in seen_urls.values():
        if remaining <= 0:
            break
        truncated = pc.content[:remaining]
        section = f"### Source: {pc.url}\n{truncated}"
        sections.append(section)
        remaining -= len(section)

    return "\n\n---\n\n".join(sections)


async def _call_llm(prompt: str, *, timeout: int) -> str | None:
    """Make a direct LLM call via the OpenAI-compatible API."""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{settings.llm_base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.llm_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.llm_fast_model,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 4096,
                },
                timeout=float(timeout),
            )

        if response.status_code != 200:
            logger.error(f"Phase 2 LLM call failed: {response.status_code} - {response.text[:200]}")
            return None

        result = response.json()
        return result["choices"][0]["message"]["content"]
    except httpx.TimeoutException:
        logger.warning(f"Phase 2 LLM call timed out ({timeout}s)")
        return None
    except Exception as e:
        logger.error(f"Phase 2 LLM call error: {e}")
        return None


_CHUNK_SUMMARY_PROMPT = """You are extracting key information from web pages that were visited during research.

## User's Original Question
{query}

## Page Content (Chunk {chunk_index})
{content}

## Instructions
- Extract all key facts, data points, and specific details relevant to the user's question.
- Preserve source URLs where available.
- Be concise but preserve specific information (names, numbers, dates, links).
- Use the same language as the user's question."""


_SYNTHESIS_PROMPT = """You are a research assistant. A web browsing agent was tasked with the user's request below.
The agent visited several web pages and collected information, but ran out of time before writing a response.

Based on the collected content, determine the nature of the task and respond appropriately:
- If this was an information gathering / research task: synthesize a comprehensive answer
  with specific facts, data, and source links.
- If this was an interactive task (form filling, purchasing, booking, etc.): report what was
  attempted, how far the agent progressed, and what remains to be done.

## User's Original Request
{query}

## Sources Visited
{source_list}

## Collected Information
{content}

## Instructions
- Write a well-structured response based on the collected content.
- Include specific facts, numbers, and details found in the content.
- Reference sources using markdown links where appropriate.
- If the collected content does not fully answer the question, note what is missing.
- Use the same language as the user's question.
- Be concise but thorough."""


async def _summarize_chunk(content: str, original_query: str, chunk_index: int) -> str | None:
    """Map phase: summarize a single chunk of page content."""
    prompt = _CHUNK_SUMMARY_PROMPT.format(
        query=original_query,
        chunk_index=chunk_index + 1,
        content=content,
    )
    return await _call_llm(prompt, timeout=PHASE2_MAP_TIMEOUT_SECONDS)


async def _summarize_page_content(
    original_query: str,
    page_contents: list[_PageContent],
    seen_urls: dict[str, None],
) -> str | None:
    """
    Phase 2: synthesize a response from accumulated page content.

    Small content (<40K chars): single LLM call.
    Large content: map-reduce (parallel chunk summaries → final synthesis).
    """
    prepared = _prepare_content_for_summarization(page_contents)
    source_list = "\n".join(f"- {url}" for url in list(seen_urls.keys())[:25])

    if len(prepared) < DIRECT_SUMMARIZE_THRESHOLD_CHARS:
        prompt = _SYNTHESIS_PROMPT.format(
            query=original_query,
            source_list=source_list,
            content=prepared,
        )
        return await _call_llm(prompt, timeout=PHASE2_REDUCE_TIMEOUT_SECONDS)

    # Map phase: split into chunks and summarize in parallel
    chunks: list[str] = []
    current_chunk: list[str] = []
    current_size = 0
    for pc in page_contents:
        if current_size + len(pc.content) > MAP_CHUNK_CHARS and current_chunk:
            chunks.append("\n\n".join(current_chunk))
            current_chunk = []
            current_size = 0
        current_chunk.append(f"### Source: {pc.url}\n{pc.content}")
        current_size += len(pc.content)
    if current_chunk:
        chunks.append("\n\n".join(current_chunk))

    logger.info(f"Phase 2 map: summarizing {len(chunks)} chunks in parallel")

    summaries = await asyncio.gather(*[_summarize_chunk(chunk, original_query, i) for i, chunk in enumerate(chunks)])

    successful = [s for s in summaries if s]
    if not successful:
        logger.warning("Phase 2 map: all chunk summaries failed")
        return None

    logger.info(f"Phase 2 map: {len(successful)}/{len(chunks)} chunks succeeded")

    # Reduce phase: synthesize chunk summaries into final response
    combined = "\n\n---\n\n".join(f"### Findings (Part {i + 1})\n{s}" for i, s in enumerate(successful))
    prompt = _SYNTHESIS_PROMPT.format(
        query=original_query,
        source_list=source_list,
        content=combined,
    )
    return await _call_llm(prompt, timeout=PHASE2_REDUCE_TIMEOUT_SECONDS)


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
            return await self._execute_opencode(message, workspace_dir, start_time, timeout_seconds)
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
            nav_terminated = False
            try:
                assert proc.stdout is not None
                async with asyncio.timeout(effective_timeout):
                    async for raw_line in proc.stdout:
                        accumulator.process_line(raw_line.decode())
                        if accumulator.should_terminate:
                            nav_terminated = True
                            break
            except TimeoutError:
                timed_out = True

            if nav_terminated or timed_out:
                reason = (
                    f"Navigation limit ({accumulator.navigation_count}/{MAX_NAVIGATION_COUNT})"
                    if nav_terminated
                    else f"Timeout ({effective_timeout}s)"
                )
                logger.warning(
                    f"{reason} reached in workspace "
                    f"{os.path.basename(workspace_dir)}, terminating OpenCode "
                    f"(accumulated {len(accumulator.text_parts)} text parts, "
                    f"{len(accumulator.page_contents)} page snapshots)"
                )
                timed_out = True
                await self._terminate_process(proc)

            stderr_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await stderr_task

            stderr_text = b"".join(stderr_parts).decode()
            if stderr_text:
                logger.debug(f"OpenCode stderr: {stderr_text[:500]}...")

            # Phase 2: summarize collected page content when Phase 1
            # timed out without producing any text response.
            if timed_out and not accumulator.text_parts and accumulator.has_page_content:
                logger.info(
                    f"Phase 2: summarizing {len(accumulator.page_contents)} page snapshots "
                    f"({accumulator._total_content_chars} chars) for workspace "
                    f"{os.path.basename(workspace_dir)}"
                )
                summary = await _summarize_page_content(
                    original_query=message,
                    page_contents=accumulator.page_contents,
                    seen_urls=accumulator.seen_urls,
                )
                if summary:
                    accumulator.text_parts.append(summary)
                    accumulator.phase2_summarized = True
                    logger.info(f"Phase 2 produced {len(summary)} char summary")
                else:
                    logger.warning("Phase 2 summarization failed, falling back to URL list")

            duration = time.perf_counter() - start_time
            return accumulator.to_response(duration, timed_out=timed_out)

        except Exception as e:
            duration = time.perf_counter() - start_time
            logger.error(f"OpenCode execution failed in workspace {os.path.basename(workspace_dir)}: {e}")
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

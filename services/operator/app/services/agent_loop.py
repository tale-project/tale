"""LLM agent loop with direct Playwright browser automation.

Replaces OpenCode CLI by calling the LLM API directly with function-calling
tools and executing browser actions via the Playwright Python API.
"""

import asyncio
import base64
import json
import shutil
import tempfile
import time
from pathlib import Path
from typing import Any

import httpx
from loguru import logger
from playwright.async_api import BrowserContext, Page
from playwright.async_api import Error as PlaywrightError

from app.config import settings
from app.services.browser_service import (
    URL_PATTERN,
    _OutputAccumulator,
    _summarize_page_content,
)

# Minimum remaining seconds to attempt another LLM call
_MIN_REMAINING_SECONDS = 10

# Time reserved for Phase 2 summarization after agent loop ends
_PHASE2_BUDGET_SECONDS = 15

# Max time for a single LLM API call
_LLM_CALL_TIMEOUT_SECONDS = 45

# Page navigation timeout (ms)
_PAGE_TIMEOUT_MS = 10_000

# Element interaction timeout (ms)
_ELEMENT_TIMEOUT_MS = 5_000

# Vision analysis timeout (seconds)
_VISION_TIMEOUT_SECONDS = 15

# Max turns before forcing agent to stop browsing and answer
_MAX_TURNS = 12

# Turn threshold at which we inject a "wrap up" reminder
_WRAP_UP_TURN = 8

# Max chars returned from snapshot to keep context window small
_MAX_SNAPSHOT_CHARS = 20_000

# Max pages to fetch in parallel
_MAX_PARALLEL_PAGES = 5

# Max chars per page in fetch_pages results (shorter than snapshot since we get multiple)
_MAX_FETCH_PAGE_CHARS = 8_000

# Max total chars across all messages before we start trimming old tool results.
# ~4 chars/token, so 120K chars ≈ 30K tokens — well within 128K context limits.
_MAX_CONTEXT_CHARS = 120_000

# When trimming, replace old tool results longer than this with a short summary
_TRIM_THRESHOLD_CHARS = 500

SYSTEM_PROMPT = """\
You are a fast, autonomous browser agent. You control a browser via tool calls.

## Tools

- **navigate**: Go to a URL.
- **go_back**: Go back.
- **snapshot**: Get the page's accessibility tree (YAML). ALWAYS call before interacting.
- **fetch_pages**: Open multiple URLs in PARALLEL tabs, extract text from all at once. \
**This is your fastest tool for reading multiple pages.** Use it after a search to read \
top results simultaneously instead of clicking them one by one.
- **take_screenshot**: Visual screenshot. Only use when you need to see images/charts/layout.
- **click**: Click element by ARIA role + name from snapshot.
- **type_text**: Type into input by role + name. Set submit=true to press Enter after.
- **press_key**: Press a keyboard key.
- **select_option**: Select dropdown option.
- **fill_form**: Fill multiple form fields.
- **wait_for**: Wait for text or seconds.

## Rules

1. **Be fast.** Minimize tool calls. Extract info from snapshot text when possible \
instead of navigating to more pages.
2. **Use fetch_pages for multiple URLs.** After a search, grab 2-3 result URLs from the \
snapshot and call fetch_pages to read them all in parallel. This is MUCH faster than \
clicking each link sequentially.
3. **Prefer snapshot over screenshot.** Snapshot is instant; screenshot requires vision analysis \
and is slow. Only use screenshot for visual content (images, charts, layout).
4. **One source is enough.** If the first page has the answer, stop. Don't visit redundant sources.
5. **Search**: Prefer DuckDuckGo (`https://duckduckgo.com/?q=...`) — it never blocks automated \
requests. Avoid Google (it blocks with CAPTCHA). After navigating to search results, use \
snapshot to read them — often the answer is in the search snippets.
6. **ALWAYS snapshot before clicking/typing.** The snapshot shows: `- role "accessible name"`.
7. **Autonomous mode**: Do NOT ask for confirmation. Proceed with reasonable assumptions.
8. **Language**: Respond in the same language as the user's message.
9. **Concise**: Give direct, factual answers. Cite sources when available.
10. **Error Handling**: If a page fails to load or an action fails, \
try alternative approaches (different search terms, different websites, etc.).
11. **Include Precise Links**: For every specific item you recommend \
(product, article, listing, etc.), provide the exact detail page URL. \
Format as markdown: [title](URL).
12. **Time Management**: You have a LIMITED time budget. Work efficiently: \
prioritize the most important information first, do NOT spend excessive time on a single source, \
and after visiting 2-3 key sources, START writing your response immediately."""


BROWSER_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "navigate",
            "description": "Navigate to a URL",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "The URL to navigate to"},
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "snapshot",
            "description": (
                "Get the accessibility tree (ARIA snapshot) of the current page. "
                "Shows all elements with their roles and accessible names. "
                "ALWAYS call this before interacting with page elements."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "click",
            "description": "Click an element identified by its ARIA role and accessible name from the snapshot.",
            "parameters": {
                "type": "object",
                "properties": {
                    "role": {
                        "type": "string",
                        "description": "ARIA role (link, button, textbox, checkbox, menuitem, tab, etc.)",
                    },
                    "name": {"type": "string", "description": "Accessible name of the element"},
                    "index": {
                        "type": "integer",
                        "description": "0-based index if multiple elements match (default: 0)",
                        "default": 0,
                    },
                },
                "required": ["role", "name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "type_text",
            "description": "Type text into an input field identified by role and name.",
            "parameters": {
                "type": "object",
                "properties": {
                    "role": {
                        "type": "string",
                        "description": "ARIA role (usually 'textbox', 'searchbox', or 'combobox')",
                    },
                    "name": {"type": "string", "description": "Accessible name / label of the field"},
                    "text": {"type": "string", "description": "Text to type"},
                    "submit": {
                        "type": "boolean",
                        "description": "Press Enter after typing",
                        "default": False,
                    },
                    "index": {
                        "type": "integer",
                        "description": "0-based index if multiple elements match (default: 0)",
                        "default": 0,
                    },
                },
                "required": ["role", "name", "text"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "press_key",
            "description": "Press a keyboard key (e.g., Enter, Tab, ArrowDown, Escape, Backspace)",
            "parameters": {
                "type": "object",
                "properties": {
                    "key": {"type": "string", "description": "Key name to press"},
                },
                "required": ["key"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "select_option",
            "description": "Select an option from a dropdown/select element.",
            "parameters": {
                "type": "object",
                "properties": {
                    "role": {
                        "type": "string",
                        "description": "ARIA role (usually 'combobox' or 'listbox')",
                    },
                    "name": {"type": "string", "description": "Accessible name of the select element"},
                    "value": {"type": "string", "description": "Option text or value to select"},
                    "index": {
                        "type": "integer",
                        "description": "0-based index if multiple elements match (default: 0)",
                        "default": 0,
                    },
                },
                "required": ["role", "name", "value"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fill_form",
            "description": "Fill multiple form fields at once. Each field is identified by role and name.",
            "parameters": {
                "type": "object",
                "properties": {
                    "fields": {
                        "type": "array",
                        "description": "List of fields to fill",
                        "items": {
                            "type": "object",
                            "properties": {
                                "role": {"type": "string", "description": "ARIA role of the field"},
                                "name": {"type": "string", "description": "Accessible name of the field"},
                                "value": {"type": "string", "description": "Value to fill"},
                            },
                            "required": ["role", "name", "value"],
                        },
                    },
                },
                "required": ["fields"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "take_screenshot",
            "description": (
                "Take a screenshot of the current page. "
                "If a vision model is configured, the screenshot will be automatically analyzed."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "full_page": {
                        "type": "boolean",
                        "description": "Capture full scrollable page instead of just the viewport",
                        "default": False,
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "wait_for",
            "description": "Wait for text to appear on the page, or wait a specified number of seconds.",
            "parameters": {
                "type": "object",
                "properties": {
                    "text": {"type": "string", "description": "Text to wait for on the page"},
                    "timeout_seconds": {
                        "type": "number",
                        "description": "Max seconds to wait (default: 5)",
                        "default": 5,
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "go_back",
            "description": "Go back to the previous page in browser history",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_pages",
            "description": (
                "Open multiple URLs in PARALLEL browser tabs and extract their text content simultaneously. "
                "Much faster than navigating to each page one by one. "
                "Use after a search to read top 2-3 results at once. Max 5 URLs."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "urls": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of URLs to fetch in parallel (max 5)",
                    },
                },
                "required": ["urls"],
            },
        },
    },
]


def _estimate_context_chars(messages: list[dict[str, Any]]) -> int:
    """Estimate total character count across all messages."""
    total = 0
    for msg in messages:
        content = msg.get("content", "")
        if isinstance(content, str):
            total += len(content)
        elif isinstance(content, list):
            for part in content:
                if isinstance(part, dict):
                    total += len(str(part.get("text", "")))
    return total


def _trim_old_tool_results(messages: list[dict[str, Any]]) -> None:
    """Trim old tool result messages to reduce context size.

    Replaces long tool results (except the most recent 4 messages) with a
    short placeholder. Mutates the list in place.
    """
    # Keep system (0), user (1), and the last 4 messages untouched
    safe_tail = max(2, len(messages) - 4)
    for i in range(2, safe_tail):
        msg = messages[i]
        content = msg.get("content", "")
        if msg.get("role") == "tool" and isinstance(content, str) and len(content) > _TRIM_THRESHOLD_CHARS:
            # Keep the first line as a summary hint
            first_line = content[:200].split("\n")[0]
            messages[i] = {**msg, "content": f"{first_line}\n...(trimmed to save context)"}


def _resolve_locator(page: Page, role: str, name: str, index: int = 0):
    """Resolve an element locator from ARIA role and name."""
    locator = page.get_by_role(role, name=name, exact=False)
    if index > 0:
        locator = locator.nth(index)
    return locator


async def _fetch_single_page(
    context: BrowserContext,
    url: str,
) -> dict[str, str]:
    """Fetch a single page in a new tab and return its content."""
    page = await context.new_page()
    try:
        response = await page.goto(url, wait_until="domcontentloaded", timeout=_PAGE_TIMEOUT_MS)
        status = response.status if response else 0
        final_url = page.url
        if "google.com/sorry" in final_url or "google.com/recaptcha" in final_url:
            return {"url": url, "title": "", "content": "BLOCKED: Google CAPTCHA", "status": "blocked"}
        title = await page.title()
        text = await page.inner_text("body")
        if len(text) > _MAX_FETCH_PAGE_CHARS:
            text = text[:_MAX_FETCH_PAGE_CHARS] + "\n...(truncated)"
        return {"url": url, "title": title, "content": text, "status": str(status)}
    except (PlaywrightError, Exception) as e:
        return {"url": url, "title": "", "content": f"Error loading page: {e}", "status": "error"}
    finally:
        await page.close()


async def _execute_tool(
    page: Page,
    tool_name: str,
    args: dict[str, Any],
    accumulator: _OutputAccumulator,
    screenshot_dir: str,
    *,
    context: BrowserContext | None = None,
) -> str:
    """Execute a single browser tool call and return the result as a string."""
    try:
        if tool_name == "navigate":
            url = args["url"]
            accumulator.record_navigation(url)
            accumulator.record_url(url)
            response = await page.goto(url, wait_until="domcontentloaded", timeout=_PAGE_TIMEOUT_MS)
            status = response.status if response else "unknown"
            final_url = page.url
            title = await page.title()
            if "google.com/sorry" in final_url or "google.com/recaptcha" in final_url:
                return (
                    f"BLOCKED: Google CAPTCHA detected at {final_url}. "
                    "Do NOT retry Google. Use https://duckduckgo.com/?q=YOUR+QUERY or "
                    "https://www.bing.com/search?q=YOUR+QUERY instead."
                )
            return f"Navigated to {final_url} (status: {status}, title: {title})"

        elif tool_name == "snapshot":
            snapshot_text = await page.locator("body").aria_snapshot()
            text_content = await page.inner_text("body")
            accumulator.record_page_content(page.url, text_content)
            accumulator.record_url(page.url)
            if len(snapshot_text) > _MAX_SNAPSHOT_CHARS:
                snapshot_text = snapshot_text[:_MAX_SNAPSHOT_CHARS] + "\n...(truncated)"
            return snapshot_text

        elif tool_name == "click":
            role = args["role"]
            name = args["name"]
            index = args.get("index", 0)
            locator = _resolve_locator(page, role, name, index)
            await locator.click(timeout=_ELEMENT_TIMEOUT_MS)
            await page.wait_for_load_state("domcontentloaded", timeout=_PAGE_TIMEOUT_MS)
            return f"Clicked {role} '{name}'"

        elif tool_name == "type_text":
            role = args["role"]
            name = args["name"]
            text = args["text"]
            submit = args.get("submit", False)
            index = args.get("index", 0)
            locator = _resolve_locator(page, role, name, index)
            await locator.fill(text)
            if submit:
                await locator.press("Enter")
                await page.wait_for_load_state("domcontentloaded", timeout=_PAGE_TIMEOUT_MS)
            return f"Typed '{text}' into {role} '{name}'" + (" and submitted" if submit else "")

        elif tool_name == "press_key":
            key = args["key"]
            await page.keyboard.press(key)
            return f"Pressed key: {key}"

        elif tool_name == "select_option":
            role = args["role"]
            name = args["name"]
            value = args["value"]
            index = args.get("index", 0)
            locator = _resolve_locator(page, role, name, index)
            await locator.select_option(value)
            return f"Selected '{value}' in {role} '{name}'"

        elif tool_name == "fill_form":
            fields = args.get("fields", [])
            results = []
            for f in fields:
                locator = _resolve_locator(page, f["role"], f["name"])
                await locator.fill(f["value"])
                results.append(f"Filled {f['role']} '{f['name']}' with '{f['value']}'")
            return "\n".join(results)

        elif tool_name == "take_screenshot":
            full_page = args.get("full_page", False)
            filename = Path(screenshot_dir) / f"screenshot-{int(time.time() * 1000)}.png"
            await page.screenshot(path=str(filename), full_page=full_page)
            if settings.llm_vision_model:
                analysis = await _analyze_screenshot(str(filename))
                return f"Screenshot taken.\n\nVisual analysis:\n{analysis}"
            return "Screenshot taken."

        elif tool_name == "wait_for":
            text = args.get("text")
            timeout = args.get("timeout_seconds", 5)
            if text:
                await page.locator(f"text={text}").wait_for(timeout=int(timeout * 1000))
                return f"Text '{text}' appeared on page"
            else:
                await asyncio.sleep(timeout)
                return f"Waited {timeout} seconds"

        elif tool_name == "fetch_pages":
            if context is None:
                return "Error: fetch_pages requires a browser context"
            urls = args.get("urls", [])[:_MAX_PARALLEL_PAGES]
            if not urls:
                return "Error: no URLs provided"
            logger.info(f"fetch_pages: fetching {len(urls)} URLs in parallel")
            tasks = [_fetch_single_page(context, url) for url in urls]
            results = await asyncio.gather(*tasks)
            parts = []
            for r in results:
                accumulator.record_navigation(r["url"])
                accumulator.record_url(r["url"])
                if not r["content"].startswith("Error"):
                    accumulator.record_page_content(r["url"], r["content"])
                parts.append(f"## {r['title']} ({r['url']})\n\n{r['content']}")
            return "\n\n---\n\n".join(parts)

        elif tool_name == "go_back":
            await page.go_back(wait_until="domcontentloaded", timeout=_PAGE_TIMEOUT_MS)
            return f"Navigated back to {page.url}"

        else:
            return f"Unknown tool: {tool_name}"

    except Exception as e:
        return f"Error executing {tool_name}: {type(e).__name__}: {e}"


async def _analyze_screenshot(image_path: str, prompt: str = "Describe what you see on this page.") -> str:
    """Analyze a screenshot using the vision model via direct API call."""
    try:
        with open(image_path, "rb") as f:
            image_data = base64.b64encode(f.read()).decode("utf-8")
    except Exception as e:
        return f"Failed to read screenshot: {e}"

    vision_base_url = settings.openai_vision_base_url or settings.llm_base_url
    vision_api_key = settings.openai_vision_api_key or settings.llm_api_key

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{vision_base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {vision_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.llm_vision_model,
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": prompt},
                                {
                                    "type": "image_url",
                                    "image_url": {"url": f"data:image/png;base64,{image_data}"},
                                },
                            ],
                        }
                    ],
                    "max_tokens": 1024,
                },
                timeout=float(_VISION_TIMEOUT_SECONDS),
            )

        if response.status_code != 200:
            logger.warning(f"Vision analysis failed: {response.status_code}")
            return "Vision analysis unavailable — use snapshot to read page text instead."

        return response.json()["choices"][0]["message"]["content"]
    except httpx.TimeoutException:
        logger.warning("Vision analysis timed out")
        return "Vision analysis timed out — use snapshot to read page text instead."
    except Exception as e:
        return f"Vision analysis error: {e}"


async def _call_llm_with_tools(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    timeout: float,
    _retries: int = 2,
) -> dict[str, Any] | None:
    """Call LLM with function-calling tools via OpenAI-compatible API."""
    last_error = None
    async with httpx.AsyncClient() as client:
        for attempt in range(_retries + 1):
            try:
                response = await client.post(
                    f"{settings.llm_base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {settings.llm_api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": settings.llm_model,
                        "messages": messages,
                        **({"tools": tools} if tools else {}),
                        "max_tokens": 4096,
                    },
                    timeout=timeout,
                )

                if response.status_code == 429 or response.status_code >= 500:
                    logger.warning(f"LLM call attempt {attempt + 1} got {response.status_code}, retrying...")
                    last_error = f"{response.status_code} - {response.text[:200]}"
                    await asyncio.sleep(2**attempt)
                    continue

                if response.status_code != 200:
                    logger.error(f"LLM tool call failed: {response.status_code} - {response.text[:500]}")
                    return None

                data = response.json()
                logger.debug(f"LLM response: finish_reason={data['choices'][0].get('finish_reason')}")
                return data
            except httpx.TimeoutException:
                logger.warning(f"LLM tool call timed out ({timeout}s)")
                return None
            except Exception as e:
                logger.warning(f"LLM call attempt {attempt + 1} error: {e}")
                last_error = str(e)
                if attempt < _retries:
                    await asyncio.sleep(2**attempt)
                    continue

    logger.error(f"LLM tool call failed after {_retries + 1} attempts: {last_error}")
    return None


async def run_agent_loop(
    message: str,
    context: BrowserContext,
    timeout_seconds: int,
) -> dict[str, Any]:
    """Core agent loop: LLM decides actions, we execute them via Playwright.

    Returns the same response dict format as the old BrowserService.
    """
    accumulator = _OutputAccumulator()
    start_time = time.perf_counter()
    screenshot_dir = tempfile.mkdtemp(prefix="operator-screenshots-")
    # Reserve time for Phase 2 summarization after the browsing loop
    loop_budget = timeout_seconds - _PHASE2_BUDGET_SECONDS

    timed_out = False
    nav_terminated = False

    try:
        page = await context.new_page()

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": message},
        ]
        turn = 0
        while True:
            turn += 1
            elapsed = time.perf_counter() - start_time
            remaining = loop_budget - elapsed
            # Trim old tool results if context is getting too large
            ctx_chars = _estimate_context_chars(messages)
            if ctx_chars > _MAX_CONTEXT_CHARS:
                _trim_old_tool_results(messages)
                new_chars = _estimate_context_chars(messages)
                logger.info(f"Trimmed context: {ctx_chars} -> {new_chars} chars")

            logger.info(f"Turn {turn}: elapsed={elapsed:.1f}s, remaining={remaining:.1f}s, msgs={len(messages)}")

            if remaining <= _MIN_REMAINING_SECONDS:
                timed_out = True
                logger.info("Timed out")
                break

            if accumulator.should_terminate:
                nav_terminated = True
                logger.info("Navigation limit reached")
                break

            if turn > _MAX_TURNS:
                timed_out = True
                logger.info(f"Max turns ({_MAX_TURNS}) reached")
                break

            # Inject wrap-up reminder when approaching turn limit
            tools = BROWSER_TOOLS
            if turn == _WRAP_UP_TURN:
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            "You are running low on turns. "
                            "Provide your answer NOW based on what you have gathered so far. "
                            "Do NOT make any more tool calls unless absolutely essential."
                        ),
                    }
                )

            # On the last allowed turn, don't offer tools — force a text response
            if turn >= _MAX_TURNS:
                tools = []

            llm_response = await _call_llm_with_tools(
                messages=messages,
                tools=tools,
                timeout=min(remaining, _LLM_CALL_TIMEOUT_SECONDS),
            )

            if llm_response is None:
                logger.warning("LLM call failed, ending agent loop")
                break

            choice = llm_response["choices"][0]
            assistant_message = choice["message"]
            messages.append(assistant_message)

            usage = llm_response.get("usage", {})
            accumulator.record_token_usage(
                input_tokens=usage.get("prompt_tokens", 0),
                output_tokens=usage.get("completion_tokens", 0),
            )

            tool_calls = assistant_message.get("tool_calls")

            if not tool_calls:
                content = assistant_message.get("content", "")
                if content:
                    accumulator.text_parts.append(content)
                    for url in URL_PATTERN.findall(content):
                        accumulator.record_url(url)
                break

            # Smart batching: when the LLM issues multiple navigate calls in one turn,
            # execute them as parallel page fetches instead of sequential (which would
            # just overwrite each other on the same page).
            parsed_calls = []
            for tc in tool_calls:
                fn = tc["function"]
                try:
                    args = json.loads(fn.get("arguments", "{}"))
                except json.JSONDecodeError:
                    args = {}
                parsed_calls.append((tc, fn["name"], args))

            navigate_calls = [(tc, args) for tc, name, args in parsed_calls if name == "navigate"]
            should_batch = len(navigate_calls) > 1 and context is not None

            if should_batch:
                urls = [args["url"] for _, args in navigate_calls]
                logger.info(f"Batching {len(urls)} navigate calls into parallel fetch")
                fetch_results = await asyncio.gather(*[_fetch_single_page(context, url) for url in urls])
                nav_results = dict(zip(urls, fetch_results, strict=True))

            for tc, tool_name, tool_args in parsed_calls:
                if should_batch and tool_name == "navigate":
                    url = tool_args["url"]
                    r = nav_results[url]
                    accumulator.record_navigation(r["url"])
                    accumulator.record_url(r["url"])
                    if not r["content"].startswith("Error"):
                        accumulator.record_page_content(r["url"], r["content"])
                    result_text = (
                        f"Navigated to {r['url']} (status: {r['status']}, title: {r['title']})\n\n"
                        f"Page content:\n{r['content']}"
                    )
                else:
                    logger.debug(f"Executing tool: {tool_name}({tool_args})")
                    result_text = await _execute_tool(
                        page,
                        tool_name,
                        tool_args,
                        accumulator,
                        screenshot_dir,
                        context=context,
                    )

                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "content": result_text,
                    }
                )

                for url in URL_PATTERN.findall(result_text):
                    accumulator.record_url(url)

        # If the loop ended without any text and without timeout/nav-limit,
        # treat it as a failed request (e.g., LLM call returned None)
        if not timed_out and not nav_terminated and not accumulator.text_parts:
            duration = time.perf_counter() - start_time
            return {
                "success": False,
                "partial": False,
                "response": "The agent could not generate a response.",
                "duration_seconds": round(duration, 2),
                "sources": list(accumulator.seen_urls.keys()),
            }

        # Phase 2 fallback: summarize collected page content when
        # terminated early without producing any text response
        terminated_early = timed_out or nav_terminated
        if terminated_early and not accumulator.text_parts and accumulator.has_page_content:
            logger.info(
                f"Phase 2: summarizing {len(accumulator.page_contents)} page snapshots "
                f"({accumulator._total_content_chars} chars)"
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
        return accumulator.to_response(duration, timed_out=timed_out, nav_terminated=nav_terminated)

    except Exception as e:
        duration = time.perf_counter() - start_time
        logger.error(f"Agent loop failed: {e}")
        return {
            "success": False,
            "partial": False,
            "response": str(e),
            "duration_seconds": round(duration, 2),
        }
    finally:
        shutil.rmtree(screenshot_dir, ignore_errors=True)

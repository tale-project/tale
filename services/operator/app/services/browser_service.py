"""Browser automation service using Playwright MCP + dual model architecture."""

import base64
from typing import Any
from urllib.parse import quote_plus

from loguru import logger

from app.config import settings
from app.lib.agent_client import AgentClient
from app.lib.mcp_client import MCPClient
from app.lib.vision_client import VisionClient
from app.models import RichData, SearchResult


class BrowserService:
    """Service for AI-powered browser automation using MCP + dual model."""

    def __init__(self):
        self._mcp_client: MCPClient | None = None
        self._agent_client: AgentClient | None = None
        self._vision_client: VisionClient | None = None
        self._initialized = False

    @property
    def initialized(self) -> bool:
        return self._initialized

    async def initialize(self) -> None:
        """Initialize the service components."""
        if self._initialized:
            return

        try:
            logger.info("Initializing browser service...")

            # Initialize clients
            self._mcp_client = MCPClient()
            self._agent_client = AgentClient()
            self._vision_client = VisionClient()

            # Start MCP Server
            await self._mcp_client.initialize()

            self._initialized = True
            logger.info("Browser service initialized")
        except Exception as e:
            logger.error(f"Failed to initialize browser service: {e}")
            raise

    async def cleanup(self) -> None:
        """Cleanup service resources."""
        if self._mcp_client:
            try:
                await self._mcp_client.cleanup()
            except Exception as e:
                logger.error(f"Error cleaning up MCP client: {e}")

        if self._agent_client:
            try:
                await self._agent_client.close()
            except Exception as e:
                logger.error(f"Error closing agent client: {e}")

        if self._vision_client:
            try:
                await self._vision_client.close()
            except Exception as e:
                logger.error(f"Error closing vision client: {e}")

        self._initialized = False
        logger.info("Browser service cleaned up")

    def _build_search_url(self, engine: str, query: str, language: str = "en") -> str:
        """Build search URL for the given engine."""
        encoded_query = quote_plus(query)

        urls = {
            "google": f"https://www.google.com/search?q={encoded_query}&hl={language}",
            "bing": f"https://www.bing.com/search?q={encoded_query}",
            "duckduckgo": f"https://duckduckgo.com/?q={encoded_query}",
        }

        return urls.get(engine, urls["google"])

    async def search(
        self,
        query: str,
        engine: str = "google",
        num_results: int = 10,
        language: str = "en",
    ) -> tuple[list[SearchResult], RichData | None, bool]:
        """
        Perform a web search using browser automation.

        Args:
            query: Search query
            engine: Search engine (google, bing, duckduckgo)
            num_results: Number of results to return
            language: Language code

        Returns:
            Tuple of (search results, rich data, captcha_detected)
        """
        if not self._initialized:
            await self.initialize()

        # State for the search
        current_engine = engine
        captcha_detected = False
        results: list[SearchResult] = []
        rich_data: RichData | None = None
        engines_tried = set()

        async def execute_tool(name: str, arguments: dict[str, Any]) -> str:
            """Execute a tool call from the agent."""
            nonlocal current_engine, captcha_detected, results, rich_data, engines_tried

            if name == "browser_navigate":
                url = arguments.get("url", "")
                try:
                    await self._mcp_client.navigate(url)
                    return f"Navigated to {url}"
                except Exception as e:
                    return f"Navigation failed: {e}"

            elif name == "browser_take_screenshot":
                try:
                    # Take screenshot
                    result = await self._mcp_client.take_screenshot()
                    logger.debug(f"Screenshot result keys: {result.keys() if isinstance(result, dict) else type(result)}")
                    logger.debug(f"Screenshot result content types: {[c.get('type') for c in result.get('content', [])]}")

                    # Get screenshot data (base64 encoded) - look for image content type
                    screenshot_data = ""
                    for content_item in result.get("content", []):
                        if content_item.get("type") == "image":
                            screenshot_data = content_item.get("data", "")
                            break

                    if not screenshot_data:
                        return "Screenshot failed: no data returned"

                    screenshot_bytes = base64.b64decode(screenshot_data)

                    # Extract content using vision model
                    extraction = await self._vision_client.extract_from_screenshot(screenshot_bytes)

                    if extraction.captcha_detected:
                        captcha_detected = True
                        engines_tried.add(current_engine)

                        # Suggest next engine
                        next_engines = ["google", "bing", "duckduckgo"]
                        for eng in next_engines:
                            if eng not in engines_tried:
                                return f"CAPTCHA detected on {current_engine}. Try navigating to {eng}: {self._build_search_url(eng, query, language)}"

                        return "CAPTCHA detected on all search engines. Call done(success=false, message='All engines blocked')"

                    # Successfully extracted results
                    for item in extraction.results[:num_results]:
                        results.append(SearchResult(
                            position=item.get("position", 0),
                            title=item.get("title", ""),
                            url=item.get("url", ""),
                            snippet=item.get("snippet", ""),
                        ))

                    if extraction.rich_data:
                        rich_data = RichData(
                            type=extraction.rich_data.get("type", "unknown"),
                            data=extraction.rich_data.get("data", {}),
                        )

                    return f"Successfully extracted {len(results)} search results. Call done(success=true, message='Extracted results')"

                except Exception as e:
                    logger.error(f"Screenshot/extraction failed: {e}")
                    return f"Screenshot failed: {e}"

            elif name == "browser_click":
                try:
                    ref = arguments.get("ref", "")
                    element = arguments.get("element", "")
                    await self._mcp_client.click(ref, element)
                    return f"Clicked element: {element or ref}"
                except Exception as e:
                    return f"Click failed: {e}"

            elif name == "browser_type":
                try:
                    ref = arguments.get("ref", "")
                    text = arguments.get("text", "")
                    submit = arguments.get("submit", False)
                    await self._mcp_client.type_text(ref, text, submit)
                    return f"Typed text: {text}"
                except Exception as e:
                    return f"Type failed: {e}"

            elif name == "browser_wait_for":
                try:
                    text = arguments.get("text")
                    time_val = arguments.get("time")
                    await self._mcp_client.wait_for(text=text, time=time_val)
                    return "Wait completed"
                except Exception as e:
                    return f"Wait failed: {e}"

            else:
                return f"Unknown tool: {name}"

        # Build the task for the agent
        search_url = self._build_search_url(engine, query, language)
        task = f"""Perform a web search for "{query}" on {engine}.

1. Navigate to: {search_url}
2. Wait briefly for the page to load
3. Take a screenshot to extract search results

If CAPTCHA is detected, you will be told which alternative engine to try.
When you have successfully extracted results (or tried all engines), call done()."""

        try:
            # Run the agent loop
            success, message = await self._agent_client.run_agent_loop(
                task=task,
                execute_tool=execute_tool,
                max_steps=settings.max_steps,
            )

            logger.info(f"Search completed: success={success}, message={message}")

            # Return results
            return results, rich_data, captcha_detected

        except Exception as e:
            logger.error(f"Search failed: {e}")
            raise

    async def search_with_fallback(
        self,
        query: str,
        num_results: int = 10,
        language: str = "en",
    ) -> tuple[list[SearchResult], RichData | None, str, bool]:
        """
        Perform a web search with automatic engine fallback.

        Args:
            query: Search query
            num_results: Number of results to return
            language: Language code

        Returns:
            Tuple of (results, rich_data, engine_used, captcha_detected)
        """
        engines = ["google", "bing", "duckduckgo"]

        for engine in engines:
            logger.info(f"Trying search engine: {engine}")

            results, rich_data, captcha = await self.search(
                query=query,
                engine=engine,
                num_results=num_results,
                language=language,
            )

            if results and not captcha:
                return results, rich_data, engine, False

            if captcha:
                logger.warning(f"CAPTCHA detected on {engine}, trying next engine")

        # All engines failed
        return [], None, engines[-1], True

    async def run_task(self, task: str, timeout: int = 60) -> Any:
        """
        Run a generic browser task.

        Args:
            task: Natural language task description
            timeout: Task timeout in seconds (for future use)

        Returns:
            Task result message
        """
        if not self._initialized:
            await self.initialize()

        result_data: dict[str, Any] = {}

        async def execute_tool(name: str, arguments: dict[str, Any]) -> str:
            """Execute a tool call."""
            nonlocal result_data

            if name == "browser_navigate":
                url = arguments.get("url", "")
                await self._mcp_client.navigate(url)
                return f"Navigated to {url}"

            elif name == "browser_take_screenshot":
                result = await self._mcp_client.take_screenshot()
                result_data["screenshot"] = result
                return "Screenshot taken"

            elif name == "browser_click":
                ref = arguments.get("ref", "")
                element = arguments.get("element", "")
                await self._mcp_client.click(ref, element)
                return f"Clicked: {element or ref}"

            elif name == "browser_type":
                ref = arguments.get("ref", "")
                text = arguments.get("text", "")
                submit = arguments.get("submit", False)
                await self._mcp_client.type_text(ref, text, submit)
                return f"Typed: {text}"

            elif name == "browser_wait_for":
                text = arguments.get("text")
                time_val = arguments.get("time")
                await self._mcp_client.wait_for(text=text, time=time_val)
                return "Wait completed"

            else:
                return f"Unknown tool: {name}"

        try:
            success, message = await self._agent_client.run_agent_loop(
                task=task,
                execute_tool=execute_tool,
                max_steps=settings.max_steps,
            )

            return {"success": success, "message": message, "data": result_data}

        except Exception as e:
            logger.error(f"Task failed: {e}")
            raise

    async def answer(
        self,
        question: str,
        language: str = "en",
    ) -> tuple[str, list[str]]:
        """
        Answer a question by searching the web and synthesizing results.

        Args:
            question: The question to answer
            language: Language code for search

        Returns:
            Tuple of (answer, sources)
        """
        if not self._initialized:
            await self.initialize()

        # State for capturing page content
        page_content = ""
        sources: list[dict[str, str]] = []

        async def execute_tool(name: str, arguments: dict[str, Any]) -> str:
            """Execute a tool call and capture page content."""
            nonlocal page_content, sources

            if name == "browser_navigate":
                url = arguments.get("url", "")
                try:
                    result = await self._mcp_client.navigate(url)
                    # The navigate result contains the page snapshot
                    content_items = result.get("content", [])
                    for item in content_items:
                        if item.get("type") == "text":
                            text_content = item.get("text", "")
                            # Extract the snapshot part (after "### Snapshot")
                            if "### Snapshot" in text_content:
                                page_content = text_content.split("### Snapshot")[1]
                            else:
                                page_content = text_content
                            break
                    return f"Navigated to {url}"
                except Exception as e:
                    return f"Navigation failed: {e}"

            elif name == "browser_take_screenshot":
                try:
                    result = await self._mcp_client.take_screenshot()
                    # Get the text content which has the page snapshot
                    for content_item in result.get("content", []):
                        if content_item.get("type") == "text":
                            text_content = content_item.get("text", "")
                            if "### Snapshot" in text_content:
                                snapshot_part = text_content.split("### Snapshot")[1]
                                if snapshot_part:
                                    page_content = snapshot_part
                            break

                    # Also try to get image for visual extraction if needed
                    screenshot_data = ""
                    for content_item in result.get("content", []):
                        if content_item.get("type") == "image":
                            screenshot_data = content_item.get("data", "")
                            break

                    if screenshot_data:
                        screenshot_bytes = base64.b64decode(screenshot_data)
                        extraction = await self._vision_client.extract_from_screenshot(screenshot_bytes)
                        # Collect sources from extraction
                        for item in extraction.results[:5]:
                            sources.append({
                                "title": item.get("title", ""),
                                "url": item.get("url", ""),
                            })

                    return "Screenshot captured and content extracted"
                except Exception as e:
                    logger.error(f"Screenshot failed: {e}")
                    return f"Screenshot failed: {e}"

            elif name == "browser_wait_for":
                time_val = arguments.get("time")
                await self._mcp_client.wait_for(time=time_val)
                return "Wait completed"

            else:
                return f"Unknown tool: {name}"

        # Build the search task
        search_url = self._build_search_url("google", question, language)
        task = f"""Search for information to answer: "{question}"

1. Navigate to: {search_url}
2. Wait briefly for the page to load
3. Take a screenshot to capture the search results

Call done() when you have captured the search results."""

        try:
            # Run the agent loop to search
            success, message = await self._agent_client.run_agent_loop(
                task=task,
                execute_tool=execute_tool,
                max_steps=5,  # Fewer steps for answer queries
            )

            if not page_content:
                return "I couldn't find enough information to answer your question.", []

            # Synthesize the answer
            answer = await self._agent_client.synthesize_answer(
                question=question,
                page_content=page_content,
                sources=sources,
            )

            source_urls = [s["url"] for s in sources if s.get("url")]
            return answer, source_urls

        except Exception as e:
            logger.error(f"Answer failed: {e}")
            raise


# Singleton instance
_browser_service: BrowserService | None = None


def get_browser_service() -> BrowserService:
    """Get the singleton browser service instance."""
    global _browser_service
    if _browser_service is None:
        _browser_service = BrowserService()
    return _browser_service

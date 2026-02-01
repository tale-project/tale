"""Browser automation service using Playwright MCP + dual model architecture."""

import base64
from typing import Any
from urllib.parse import quote_plus

from loguru import logger

from app.config import settings
from app.lib.agent_client import AgentClient
from app.lib.mcp_client import MCPClient
from app.lib.vision_client import VisionClient


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

            self._mcp_client = MCPClient()
            self._agent_client = AgentClient()
            self._vision_client = VisionClient()

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

    def _build_search_url(self, query: str) -> str:
        """Build Google search URL."""
        encoded_query = quote_plus(query)
        return f"https://www.google.com/search?q={encoded_query}"

    async def run_task(self, task: str, timeout: int = 60) -> Any:
        """
        Run a generic browser task and synthesize useful results.

        Args:
            task: Natural language task description
            timeout: Task timeout in seconds (for future use)

        Returns:
            Task result with success status and synthesized message
        """
        if not self._initialized:
            await self.initialize()

        page_contents: list[str] = []
        urls_visited: list[str] = []

        async def execute_tool(name: str, arguments: dict[str, Any]) -> str:
            """Execute a tool call and collect page content."""
            nonlocal page_contents, urls_visited

            if name == "browser_navigate":
                url = arguments.get("url", "")
                try:
                    result = await self._mcp_client.navigate(url)
                    urls_visited.append(url)
                    content_items = result.get("content", [])
                    for item in content_items:
                        if item.get("type") == "text":
                            text_content = item.get("text", "")
                            if "### Snapshot" in text_content:
                                page_contents.append(text_content.split("### Snapshot")[1])
                            else:
                                page_contents.append(text_content)
                            break
                    return f"Navigated to {url}"
                except Exception as e:
                    return f"Navigation failed: {e}"

            elif name == "browser_take_screenshot":
                try:
                    result = await self._mcp_client.take_screenshot()
                    for content_item in result.get("content", []):
                        if content_item.get("type") == "text":
                            text_content = content_item.get("text", "")
                            if "### Snapshot" in text_content:
                                snapshot_part = text_content.split("### Snapshot")[1]
                                if snapshot_part:
                                    page_contents.append(snapshot_part)
                            break
                    return "Screenshot captured"
                except Exception as e:
                    return f"Screenshot failed: {e}"

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
            success, agent_message = await self._agent_client.run_agent_loop(
                task=task,
                execute_tool=execute_tool,
                max_steps=settings.max_steps,
            )

            if page_contents:
                message = await self._agent_client.synthesize_task_result(
                    task=task,
                    page_contents=page_contents,
                    urls_visited=urls_visited,
                )
            else:
                message = agent_message

            return {"success": success, "message": message}

        except Exception as e:
            logger.error(f"Task failed: {e}")
            raise

    async def answer(self, question: str) -> tuple[str, list[str]]:
        """
        Answer a question by searching the web and synthesizing results.

        Args:
            question: The question to answer

        Returns:
            Tuple of (answer, sources)
        """
        if not self._initialized:
            await self.initialize()

        page_content = ""
        sources: list[dict[str, str]] = []

        async def execute_tool(name: str, arguments: dict[str, Any]) -> str:
            """Execute a tool call and capture page content."""
            nonlocal page_content, sources

            if name == "browser_navigate":
                url = arguments.get("url", "")
                try:
                    result = await self._mcp_client.navigate(url)
                    content_items = result.get("content", [])
                    for item in content_items:
                        if item.get("type") == "text":
                            text_content = item.get("text", "")
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
                    for content_item in result.get("content", []):
                        if content_item.get("type") == "text":
                            text_content = content_item.get("text", "")
                            if "### Snapshot" in text_content:
                                snapshot_part = text_content.split("### Snapshot")[1]
                                if snapshot_part:
                                    page_content = snapshot_part
                            break

                    screenshot_data = ""
                    for content_item in result.get("content", []):
                        if content_item.get("type") == "image":
                            screenshot_data = content_item.get("data", "")
                            break

                    if screenshot_data:
                        screenshot_bytes = base64.b64decode(screenshot_data)
                        extraction = await self._vision_client.extract_from_screenshot(screenshot_bytes)
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

        search_url = self._build_search_url(question)
        task = f"""Search for information to answer: "{question}"

1. Navigate to: {search_url}
2. Wait briefly for the page to load
3. Take a screenshot to capture the search results

Call done() when you have captured the search results."""

        try:
            success, message = await self._agent_client.run_agent_loop(
                task=task,
                execute_tool=execute_tool,
                max_steps=5,
            )

            if not page_content:
                return "I couldn't find enough information to answer your question.", []

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


_browser_service: BrowserService | None = None


def get_browser_service() -> BrowserService:
    """Get the singleton browser service instance."""
    global _browser_service
    if _browser_service is None:
        _browser_service = BrowserService()
    return _browser_service

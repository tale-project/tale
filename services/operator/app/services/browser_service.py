"""Browser automation service using Claude Code CLI with Playwright MCP."""

import asyncio
import json
from typing import Any

from loguru import logger

from app.config import settings


class BrowserService:
    """Service for AI-powered browser automation using Claude Code + Playwright MCP."""

    def __init__(self):
        self._initialized = False

    @property
    def initialized(self) -> bool:
        return self._initialized

    async def initialize(self) -> None:
        """Initialize the service (verify Claude Code is available)."""
        if self._initialized:
            return

        try:
            logger.info("Initializing browser service...")

            # Verify Claude Code is available
            proc = await asyncio.create_subprocess_exec(
                "claude", "--version",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()

            if proc.returncode != 0:
                raise RuntimeError(f"Claude Code not available: {stderr.decode()}")

            version = stdout.decode().strip()
            logger.info(f"Claude Code version: {version}")

            self._initialized = True
            logger.info("Browser service initialized with Claude Code")

        except Exception as e:
            logger.error(f"Failed to initialize browser service: {e}")
            raise

    async def cleanup(self) -> None:
        """Cleanup service resources."""
        self._initialized = False
        logger.info("Browser service cleaned up")

    async def _run_claude(
        self,
        prompt: str,
        max_turns: int | None = None,
        system_prompt: str | None = None,
    ) -> dict[str, Any]:
        """
        Run Claude Code CLI with given prompt.

        Args:
            prompt: The task/question for Claude
            max_turns: Maximum agentic turns (defaults to settings.max_steps)
            system_prompt: Optional system prompt to append

        Returns:
            Dict with success status and result
        """
        if max_turns is None:
            max_turns = settings.max_steps

        cmd = [
            "claude",
            "-p", prompt,  # Print mode (non-interactive)
            "--output-format", "json",
            "--max-turns", str(max_turns),
        ]

        if system_prompt:
            cmd.extend(["--append-system-prompt", system_prompt])

        logger.info(f"Running Claude Code: {' '.join(cmd[:4])}...")
        logger.debug(f"Full prompt: {prompt[:200]}...")

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env={
                    **dict(__import__("os").environ),
                    "ANTHROPIC_BASE_URL": "http://127.0.0.1:4000",
                    "ANTHROPIC_API_KEY": settings.litellm_master_key,
                },
            )

            stdout, stderr = await asyncio.wait_for(
                proc.communicate(),
                timeout=settings.timeout * max_turns,  # Scale timeout with turns
            )

            stdout_text = stdout.decode()
            stderr_text = stderr.decode()

            if stderr_text:
                logger.debug(f"Claude Code stderr: {stderr_text}")

            # Parse JSON output
            try:
                result = json.loads(stdout_text)
                return {
                    "success": result.get("is_error", False) is False,
                    "result": result.get("result", stdout_text),
                    "cost": result.get("cost_usd"),
                    "turns": result.get("num_turns"),
                }
            except json.JSONDecodeError:
                # Fallback to plain text if not JSON
                return {
                    "success": proc.returncode == 0,
                    "result": stdout_text,
                }

        except asyncio.TimeoutError:
            logger.error("Claude Code execution timed out")
            return {
                "success": False,
                "result": "Task timed out",
            }
        except Exception as e:
            logger.error(f"Claude Code execution failed: {e}")
            return {
                "success": False,
                "result": str(e),
            }

    async def run_task(self, task: str, timeout: int = 60) -> Any:
        """
        Run a generic browser task using Claude Code + Playwright MCP.

        Args:
            task: Natural language task description
            timeout: Task timeout in seconds (used as base for calculation)

        Returns:
            Task result with success status and message
        """
        if not self._initialized:
            await self.initialize()

        system_prompt = """You have access to Playwright MCP for browser automation.

Available browser tools:
- mcp__playwright__browser_navigate: Navigate to URLs
- mcp__playwright__browser_snapshot: Get page accessibility snapshot
- mcp__playwright__browser_click: Click elements
- mcp__playwright__browser_type: Type text into inputs
- mcp__playwright__browser_wait_for: Wait for conditions
- mcp__playwright__browser_take_screenshot: Take screenshots

Strategies:
1. For web search: Use Google, Bing, or DuckDuckGo
2. For specific sites: Navigate directly to relevant websites
3. Click through results to get detailed information
4. Interact with chatbots/forms when helpful
5. Take snapshots to understand page content

Always provide a helpful summary of what you found."""

        result = await self._run_claude(
            prompt=task,
            system_prompt=system_prompt,
        )

        return {
            "success": result["success"],
            "message": result["result"],
        }

    async def answer(self, question: str) -> tuple[str, list[str]]:
        """
        Answer a question by searching the web using Claude Code + Playwright.

        Args:
            question: The question to answer

        Returns:
            Tuple of (answer, sources)
        """
        if not self._initialized:
            await self.initialize()

        prompt = f"""Answer this question by searching the web: "{question}"

Steps:
1. Navigate to Google and search for relevant information
2. Take a snapshot to see the search results
3. Click on promising results to get detailed information
4. Synthesize the information into a clear, direct answer

Provide a concise, factual answer based on what you find.
Respond in the same language as the question.
Do NOT include URLs in your answer - just the information."""

        result = await self._run_claude(
            prompt=prompt,
            max_turns=10,  # Limit turns for answer queries
        )

        # Extract answer from result
        answer = result.get("result", "")
        if isinstance(answer, dict):
            answer = answer.get("result", str(answer))

        # Sources would need to be extracted from Claude's response
        # For now, return empty list as Claude handles source attribution internally
        sources: list[str] = []

        if not result["success"]:
            return "I couldn't find enough information to answer your question.", []

        return answer, sources


_browser_service: BrowserService | None = None


def get_browser_service() -> BrowserService:
    """Get the singleton browser service instance."""
    global _browser_service
    if _browser_service is None:
        _browser_service = BrowserService()
    return _browser_service

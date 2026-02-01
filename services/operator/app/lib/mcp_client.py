"""Playwright MCP Server client using JSON-RPC over stdio."""

import asyncio
import json
import os
import subprocess
from typing import Any

from loguru import logger

from app.config import settings


class MCPClient:
    """Client for Playwright MCP Server."""

    def __init__(self):
        self._process: subprocess.Popen | None = None
        self._request_id = 0
        self._initialized = False
        self._lock = asyncio.Lock()

    async def initialize(self) -> None:
        """Start the MCP Server process."""
        if self._initialized:
            return

        async with self._lock:
            if self._initialized:
                return

            logger.info("Starting Playwright MCP Server...")

            # Build MCP Server command with options
            cmd = ["npx", "@playwright/mcp"]

            # Add headless flag
            if settings.headless:
                cmd.append("--headless")

            # Disable Chrome sandbox for Docker environments
            # Chrome sandbox requires special kernel capabilities not available in Docker by default
            cmd.append("--no-sandbox")

            logger.debug(f"Starting MCP Server with command: {' '.join(cmd)}")

            self._process = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=os.environ,
            )

            # Initialize MCP connection
            await self._send_initialize()
            self._initialized = True
            logger.info("Playwright MCP Server initialized")

    async def cleanup(self) -> None:
        """Stop the MCP Server process."""
        if not self._initialized:
            return

        async with self._lock:
            if self._process:
                self._process.terminate()
                try:
                    self._process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self._process.kill()
                self._process = None
            self._initialized = False
            logger.info("Playwright MCP Server stopped")

    async def _send_initialize(self) -> dict[str, Any]:
        """Send MCP initialize request."""
        return await self._send_request("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "tale-operator", "version": "0.1.0"},
        })

    async def _send_request(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        """Send JSON-RPC request to MCP Server."""
        if not self._process or not self._process.stdin or not self._process.stdout:
            raise RuntimeError("MCP Server not running")

        self._request_id += 1
        request = {
            "jsonrpc": "2.0",
            "id": self._request_id,
            "method": method,
            "params": params,
        }

        # Send request
        request_bytes = json.dumps(request).encode() + b"\n"
        self._process.stdin.write(request_bytes)
        self._process.stdin.flush()

        # Read response (blocking, should use asyncio for production)
        loop = asyncio.get_event_loop()
        response_line = await loop.run_in_executor(
            None, self._process.stdout.readline
        )

        if not response_line:
            raise RuntimeError("MCP Server closed connection")

        response = json.loads(response_line.decode())

        if "error" in response:
            raise RuntimeError(f"MCP error: {response['error']}")

        return response.get("result", {})

    async def call_tool(self, name: str, arguments: dict[str, Any] | None = None) -> Any:
        """Call an MCP tool."""
        if not self._initialized:
            await self.initialize()

        logger.debug(f"Calling MCP tool: {name} with args: {arguments}")

        result = await self._send_request("tools/call", {
            "name": name,
            "arguments": arguments or {},
        })

        logger.debug(f"MCP tool result: {result}")
        return result

    async def list_tools(self) -> list[dict[str, Any]]:
        """List available MCP tools."""
        if not self._initialized:
            await self.initialize()

        result = await self._send_request("tools/list", {})
        return result.get("tools", [])

    # Convenience methods for common browser operations

    async def navigate(self, url: str) -> dict[str, Any]:
        """Navigate to a URL."""
        return await self.call_tool("browser_navigate", {"url": url})

    async def take_screenshot(self, filename: str | None = None) -> dict[str, Any]:
        """Take a screenshot of the current page."""
        args = {"type": "png"}
        if filename:
            args["filename"] = filename
        return await self.call_tool("browser_take_screenshot", args)

    async def get_snapshot(self) -> dict[str, Any]:
        """Get accessibility snapshot of the page."""
        return await self.call_tool("browser_snapshot", {})

    async def click(self, ref: str, element: str | None = None) -> dict[str, Any]:
        """Click an element."""
        args = {"ref": ref}
        if element:
            args["element"] = element
        return await self.call_tool("browser_click", args)

    async def type_text(self, ref: str, text: str, submit: bool = False) -> dict[str, Any]:
        """Type text into an element."""
        return await self.call_tool("browser_type", {
            "ref": ref,
            "text": text,
            "submit": submit,
        })

    async def wait_for(
        self,
        text: str | None = None,
        text_gone: str | None = None,
        time: float | None = None,
    ) -> dict[str, Any]:
        """Wait for text to appear/disappear or time to pass."""
        args = {}
        if text:
            args["text"] = text
        if text_gone:
            args["textGone"] = text_gone
        if time:
            args["time"] = time
        return await self.call_tool("browser_wait_for", args)

    async def press_key(self, key: str) -> dict[str, Any]:
        """Press a key."""
        return await self.call_tool("browser_press_key", {"key": key})

    async def close(self) -> dict[str, Any]:
        """Close the browser."""
        return await self.call_tool("browser_close", {})

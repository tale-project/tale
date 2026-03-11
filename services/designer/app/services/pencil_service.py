"""Pencil MCP server process management.

Starts the Pencil MCP server binary as a subprocess and provides an
MCP ClientSession for use by the agent service.
"""

import asyncio
from pathlib import Path

from loguru import logger
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from ..config import settings


class PencilService:
    """Manages the Pencil MCP server subprocess and client session."""

    def __init__(self) -> None:
        self._initialized = False
        self._mcp_server_path: Path | None = None

    @property
    def initialized(self) -> bool:
        return self._initialized

    async def initialize(self) -> None:
        """Validate the Pencil MCP server binary is available."""
        path = Path(settings.pencil_mcp_server_path)
        if not path.exists():
            logger.warning("Pencil MCP server binary not found at {}; service will run in degraded mode", path)
            return

        self._mcp_server_path = path
        self._initialized = True
        logger.info("Pencil MCP server binary ready at {}", path)

    async def create_session(self) -> tuple[ClientSession, object]:
        """Create a new MCP client session connected to the Pencil MCP server.

        Returns (session, context_manager) — caller must use as async context.
        Raises RuntimeError if Pencil is not initialized.
        """
        if not self._initialized or self._mcp_server_path is None:
            raise RuntimeError("Pencil MCP server is not available")

        params = StdioServerParameters(
            command=str(self._mcp_server_path),
            args=[],
            env=None,
        )
        return params

    async def shutdown(self) -> None:
        self._initialized = False
        logger.info("Pencil service shut down")


pencil_service = PencilService()


async def get_pencil_session():
    """Async context manager that yields a live Pencil MCP ClientSession."""
    params = await pencil_service.create_session()
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            yield session

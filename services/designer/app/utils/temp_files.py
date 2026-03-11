"""Temporary workspace management for document processing."""

import tempfile
from contextlib import asynccontextmanager
from pathlib import Path


@asynccontextmanager
async def temp_workspace():
    """Async context manager providing an isolated temporary directory.

    The directory and all its contents are automatically removed on exit.
    """
    with tempfile.TemporaryDirectory(prefix="designer_") as tmp:
        yield Path(tmp)

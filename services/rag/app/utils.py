"""Utility functions for Tale RAG service."""

import gc
import os
from typing import Optional

from loguru import logger


# Optional memory debug logging (disabled by default; enable with RAG_DEBUG_MEMORY=1)
_DEBUG_MEMORY = os.getenv("RAG_DEBUG_MEMORY", "").lower() in ("1", "true", "yes")


def _log_memory_snapshot(context: str) -> None:
    """Log current RSS in MiB when debug memory logging is enabled.

    This reads /proc/self/statm which is available inside our Linux containers.
    """
    if not _DEBUG_MEMORY:
        return

    try:
        with open("/proc/self/statm") as f:
            parts = f.read().split()
        # statm reports the number of pages; convert to MiB
        pages = int(parts[1])
        rss_mb = pages * (os.sysconf("SC_PAGE_SIZE") / (1024 * 1024))
        logger.info(f"[RAG][MEM] {context}: RSS={rss_mb:.1f} MiB")
    except Exception as exc:  # pragma: no cover - best-effort logging
        logger.debug(f"[RAG][MEM] Failed to read RSS: {exc}")


def cleanup_memory(context: Optional[str] = None) -> None:
    """Force Python garbage collection to free memory after heavy RAG operations.

    Note: This mainly helps reclaim unreachable Python objects. The overall RSS of
    the process may not drop immediately because the allocator keeps arenas
    reserved for reuse, but this reduces long-term growth.
    """
    collected = gc.collect()
    logger.debug(f"[RAG] Garbage collection freed {collected} objects")
    if context:
        _log_memory_snapshot(context)


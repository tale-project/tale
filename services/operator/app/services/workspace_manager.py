"""Workspace management for concurrent browser requests."""

import asyncio
import os
import shutil
import time
from dataclasses import dataclass, field
from pathlib import Path
from uuid import uuid4

from loguru import logger

from app.config import settings


@dataclass
class WorkspaceInfo:
    """Metadata for a workspace."""

    workspace_id: str
    path: str
    created_at: float = field(default_factory=time.time)


class WorkspaceManager:
    """
    Manages isolated workspaces for concurrent browser requests.

    Key responsibilities:
    - Create isolated workspace directories for each request
    - Track active workspaces and enforce concurrency limits
    - Background cleanup of stale workspaces
    - Enforce disk space limits
    - Clean up orphaned workspaces on startup
    """

    def __init__(self) -> None:
        self._workspaces: dict[str, WorkspaceInfo] = {}
        self._lock = asyncio.Lock()
        self._cleanup_task: asyncio.Task | None = None
        self._shutdown_event = asyncio.Event()
        self._initialized = False

    @property
    def initialized(self) -> bool:
        return self._initialized

    @property
    def active_count(self) -> int:
        return len(self._workspaces)

    async def initialize(self) -> None:
        """Initialize workspace manager and start cleanup task."""
        if self._initialized:
            return

        base_dir = Path(settings.workspace_base_dir)
        base_dir.mkdir(parents=True, exist_ok=True)

        await self._cleanup_orphaned_workspaces()

        self._cleanup_task = asyncio.create_task(self._cleanup_loop())
        self._cleanup_task.add_done_callback(self._on_cleanup_task_done)

        self._initialized = True
        logger.info(
            f"WorkspaceManager initialized: "
            f"max_concurrent={settings.max_concurrent_requests}, "
            f"timeout={settings.request_timeout_seconds}s, "
            f"max_disk={settings.workspace_max_size_mb}MB, "
            f"base_dir={settings.workspace_base_dir}"
        )

    async def shutdown(self) -> None:
        """Graceful shutdown: cleanup all workspaces."""
        logger.info("WorkspaceManager shutting down...")

        self._shutdown_event.set()

        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass

        async with self._lock:
            workspace_ids = list(self._workspaces.keys())
            for workspace_id in workspace_ids:
                await self._remove_workspace(workspace_id)

        self._initialized = False
        logger.info("WorkspaceManager shutdown complete")

    async def create_workspace(self) -> str:
        """
        Create an isolated workspace directory for a request.

        Returns:
            Path to the created workspace directory.

        Raises:
            RuntimeError: If max concurrent requests limit reached.
        """
        async with self._lock:
            if len(self._workspaces) >= settings.max_concurrent_requests:
                await self._cleanup_stale_workspaces()

                if len(self._workspaces) >= settings.max_concurrent_requests:
                    raise RuntimeError(
                        f"Maximum concurrent requests reached ({settings.max_concurrent_requests}). "
                        "Please wait for existing requests to complete."
                    )

            await self._enforce_disk_limit()

            workspace_id = str(uuid4())
            workspace_path = os.path.join(settings.workspace_base_dir, workspace_id)
            os.makedirs(workspace_path, exist_ok=True)

            self._workspaces[workspace_id] = WorkspaceInfo(
                workspace_id=workspace_id,
                path=workspace_path,
            )

            logger.debug(f"Created workspace: {workspace_id}")
            return workspace_path

    async def release_workspace(self, workspace_path: str) -> None:
        """
        Release a workspace after request completion.

        Args:
            workspace_path: Path to the workspace to release.
        """
        workspace_id = os.path.basename(workspace_path)

        async with self._lock:
            await self._remove_workspace(workspace_id)

    async def _remove_workspace(self, workspace_id: str) -> bool:
        """Internal: remove workspace and delete directory."""
        info = self._workspaces.pop(workspace_id, None)
        if not info:
            return False

        workspace = Path(info.path)
        if workspace.exists():
            try:
                shutil.rmtree(workspace)
                logger.debug(f"Removed workspace: {workspace_id}")
            except Exception as e:
                logger.warning(f"Failed to remove workspace {workspace_id}: {e}")
                return False

        return True

    async def _cleanup_loop(self) -> None:
        """Background task: periodic cleanup of stale workspaces."""
        while not self._shutdown_event.is_set():
            try:
                await asyncio.sleep(settings.cleanup_interval_seconds)
                async with self._lock:
                    await self._cleanup_stale_workspaces()
                    await self._enforce_disk_limit()
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("Error in workspace cleanup loop")

    async def _cleanup_stale_workspaces(self) -> int:
        """Cleanup workspaces that have exceeded their timeout."""
        now = time.time()
        stale_ids: list[str] = []

        for workspace_id, info in self._workspaces.items():
            age_seconds = now - info.created_at
            if age_seconds > settings.request_timeout_seconds:
                stale_ids.append(workspace_id)

        for workspace_id in stale_ids:
            await self._remove_workspace(workspace_id)

        if stale_ids:
            logger.info(f"Cleaned up {len(stale_ids)} stale workspaces")

        return len(stale_ids)

    async def _cleanup_orphaned_workspaces(self) -> None:
        """Remove workspace directories without active tracking (startup cleanup)."""
        base_dir = Path(settings.workspace_base_dir)
        if not base_dir.exists():
            return

        active_ids = set(self._workspaces.keys())
        cleaned = 0

        for item in base_dir.iterdir():
            if item.is_dir() and item.name not in active_ids:
                try:
                    shutil.rmtree(item)
                    cleaned += 1
                    logger.debug(f"Removed orphaned workspace: {item.name}")
                except Exception as e:
                    logger.warning(f"Failed to remove orphaned workspace {item.name}: {e}")

        if cleaned:
            logger.info(f"Cleaned up {cleaned} orphaned workspaces from previous run")

    async def _enforce_disk_limit(self) -> None:
        """Enforce total workspace disk limit by removing oldest workspaces."""
        base_dir = Path(settings.workspace_base_dir)
        if not base_dir.exists():
            return

        total_size_bytes = sum(
            f.stat().st_size for f in base_dir.rglob("*") if f.is_file()
        )
        total_size_mb = total_size_bytes / (1024 * 1024)

        if total_size_mb <= settings.workspace_max_size_mb:
            return

        logger.warning(
            f"Workspace disk usage ({total_size_mb:.1f}MB) exceeds limit "
            f"({settings.workspace_max_size_mb}MB), cleaning up oldest workspaces"
        )

        sorted_workspaces = sorted(
            self._workspaces.items(),
            key=lambda x: x[1].created_at,
        )

        for workspace_id, info in sorted_workspaces:
            if total_size_mb <= settings.workspace_max_size_mb * 0.8:
                break

            workspace = Path(info.path)
            if workspace.exists():
                size = sum(f.stat().st_size for f in workspace.rglob("*") if f.is_file())
                total_size_mb -= size / (1024 * 1024)

            await self._remove_workspace(workspace_id)

    def _on_cleanup_task_done(self, task: asyncio.Task) -> None:
        """Callback when cleanup task exits."""
        try:
            task.result()
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception("Workspace cleanup task died unexpectedly")


_workspace_manager: WorkspaceManager | None = None


def get_workspace_manager() -> WorkspaceManager:
    """Get the singleton workspace manager instance."""
    global _workspace_manager
    if _workspace_manager is None:
        _workspace_manager = WorkspaceManager()
    return _workspace_manager

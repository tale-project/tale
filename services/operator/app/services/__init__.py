"""
Services for the Operator service.
"""

from app.services.browser_service import BrowserService, get_browser_service
from app.services.workspace_manager import WorkspaceManager, get_workspace_manager

__all__ = [
    "BrowserService",
    "get_browser_service",
    "WorkspaceManager",
    "get_workspace_manager",
]

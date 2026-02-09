"""
Services for the Operator service.
"""

from app.services.browser_service import BrowserService, get_browser_service
from app.services.workspace_manager import WorkspaceManager, get_workspace_manager

__all__ = [
    "BrowserService",
    "WorkspaceManager",
    "get_browser_service",
    "get_workspace_manager",
]

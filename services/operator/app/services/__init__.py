"""
Services for the Operator service.
"""

from app.services.browser_pool import BrowserPool, get_browser_pool
from app.services.browser_service import BrowserService, get_browser_service

__all__ = [
    "BrowserPool",
    "BrowserService",
    "get_browser_pool",
    "get_browser_service",
]

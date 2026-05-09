"""API routers for Tale RAG service."""

from .documents import router as documents_router
from .health import protected_router as health_protected_router
from .health import public_router as health_public_router
from .search import router as search_router

__all__ = [
    "documents_router",
    "health_protected_router",
    "health_public_router",
    "search_router",
]

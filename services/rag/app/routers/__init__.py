"""API routers for Tale RAG service."""

from .documents import router as documents_router
from .health import router as health_router
from .jobs import router as jobs_router
from .search import router as search_router

__all__ = ["documents_router", "health_router", "jobs_router", "search_router"]

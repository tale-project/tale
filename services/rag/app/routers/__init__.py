"""API routers for Tale RAG service."""

from .health import router as health_router
from .documents import router as documents_router
from .search import router as search_router
from .jobs import router as jobs_router

__all__ = ["health_router", "documents_router", "search_router", "jobs_router"]

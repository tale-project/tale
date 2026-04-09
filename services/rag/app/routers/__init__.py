"""API routers for Tale RAG service."""

from .documents import router as documents_router
from .health import router as health_router
from .llm_cache import router as llm_cache_router
from .search import router as search_router

__all__ = ["documents_router", "health_router", "llm_cache_router", "search_router"]

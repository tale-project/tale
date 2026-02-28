"""Health and configuration endpoints for Tale RAG service."""

from typing import Any

from fastapi import APIRouter

from .. import __version__
from ..config import settings
from ..models import ConfigResponse, HealthResponse
from ..services.rag_service import rag_service

router = APIRouter(tags=["Health"])


@router.get("/", response_model=dict[str, Any])
async def root():
    """Root endpoint with API information."""
    return {
        "name": "Tale RAG API",
        "version": __version__,
        "description": "Retrieval-Augmented Generation service for Tale",
        "docs": "/docs",
        "redoc": "/redoc",
        "openapi": "/openapi.json",
        "health": "/health",
    }


@router.get("/health", response_model=HealthResponse)
async def health():
    """Health check endpoint.

    Returns status="healthy" when the RAG service is initialized,
    status="degraded" when not yet initialized.
    """
    is_initialized = rag_service.initialized
    return HealthResponse(
        status="healthy" if is_initialized else "degraded",
        version=__version__,
        initialized=is_initialized,
    )


@router.get("/config", response_model=ConfigResponse)
async def get_config():
    """Get current configuration (non-sensitive values only)."""
    llm_config = settings.get_llm_config()
    return ConfigResponse(
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level,
        openai_model=llm_config.get("model", ""),
        openai_embedding_model=llm_config.get("embedding_model", ""),
        chunk_size=settings.chunk_size,
        chunk_overlap=settings.chunk_overlap,
        top_k=settings.top_k,
        similarity_threshold=settings.similarity_threshold,
    )

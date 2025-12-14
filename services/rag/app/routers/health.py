"""Health and configuration endpoints for Tale RAG service."""

from typing import Any, Dict

from fastapi import APIRouter

from .. import __version__
from ..config import settings
from ..models import HealthResponse, ConfigResponse
from ..services.cognee import cognee_service

router = APIRouter(tags=["Health"])


@router.get("/", response_model=Dict[str, Any])
async def root():
    """Root endpoint with API information."""
    return {
        "name": "Tale RAG API",
        "version": __version__,
        "description": "Retrieval-Augmented Generation service using cognee",
        "docs": "/docs",
        "redoc": "/redoc",
        "openapi": "/openapi.json",
        "health": "/health",
    }


@router.get("/health", response_model=HealthResponse)
async def health():
    """Health check endpoint."""
    return HealthResponse(
        status="healthy",
        version=__version__,
        cognee_initialized=cognee_service.initialized,
    )


@router.get("/config", response_model=ConfigResponse)
async def get_config():
    """Get current configuration (non-sensitive values only)."""
    llm_config = settings.get_llm_config()
    return ConfigResponse(
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level,
        vector_db_url=settings.vector_db_url,
        vector_db_collection_name=settings.vector_db_collection_name,
        openai_model=llm_config.get("model", ""),
        openai_embedding_model=llm_config.get("embedding_model", ""),
        chunk_size=settings.chunk_size,
        chunk_overlap=settings.chunk_overlap,
        top_k=settings.top_k,
        similarity_threshold=settings.similarity_threshold,
        enable_graph_storage=settings.enable_graph_storage,
        enable_vector_search=settings.enable_vector_search,
    )


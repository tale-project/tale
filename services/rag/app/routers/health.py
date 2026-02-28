"""Health and configuration endpoints for Tale RAG service."""

from typing import Any

from fastapi import APIRouter, HTTPException, status
from loguru import logger

from .. import __version__
from ..config import settings
from ..models import ConfigResponse, HealthResponse
from ..services.database import get_pool
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

    Returns status="healthy" when the RAG service is initialized and
    the database is reachable, status="degraded" otherwise.
    """
    is_initialized = rag_service.initialized
    db_ok = False

    if is_initialized:
        try:
            pool = await get_pool()
            async with pool.acquire() as conn:
                await conn.fetchval("SELECT 1")
            db_ok = True
        except Exception:
            logger.warning("Health check database ping failed")

    if is_initialized and db_ok:
        health_status = "healthy"
    elif is_initialized:
        health_status = "degraded"
    else:
        health_status = "degraded"

    return HealthResponse(
        status=health_status,
        version=__version__,
        initialized=is_initialized,
    )


@router.get("/config", response_model=ConfigResponse)
async def get_config():
    """Get current configuration (non-sensitive values only)."""
    try:
        llm_config = settings.get_llm_config()
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="LLM configuration not available",
        ) from exc

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

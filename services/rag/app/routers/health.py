"""Health and configuration endpoints for Tale RAG service.

Two routers are exported:

- `public_router` — `/`, `/health`. Reachable WITHOUT the bearer token
  so docker / k8s liveness + readiness probes keep working with no
  config.
- `protected_router` — `/config`. Mounted under
  `Depends(verify_auth_token)`; previously bundled with the public
  router and accidentally unauthenticated, leaking model names, host /
  port, chunking params (round-2 v15 CRITICAL).
"""

from typing import Any

from fastapi import APIRouter, HTTPException, status
from loguru import logger

from .. import __version__
from ..config import settings
from ..models import ConfigResponse, HealthResponse
from ..services.database import get_pool
from ..services.rag_service import rag_service

public_router = APIRouter(tags=["Health"])
protected_router = APIRouter(tags=["Health"])

# Backwards-compat re-export for any caller still importing `router`. The
# public-vs-protected split happens at mount time in `main.py`.
router = public_router


@public_router.get("/", response_model=dict[str, Any])
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


@public_router.get("/health", response_model=HealthResponse)
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
            # Round-2 review LOW (E.4.10): include the stack trace so
            # operators can diagnose health-check failures without
            # additional reproduction steps. Pre-fix, this swallowed
            # the exception with no detail.
            logger.warning("Health check database ping failed", exc_info=True)

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


@protected_router.get("/config", response_model=ConfigResponse)
async def get_config():
    """Get current configuration (non-sensitive values only).

    Auth-gated via the protected router; before round-2 v15 this leaked
    deployment fingerprints (model names, host/port, chunking params)
    to any caller with reach to the RAG port.
    """
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

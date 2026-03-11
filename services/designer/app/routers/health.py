"""Health endpoints for Tale Designer service."""

from typing import Any

from fastapi import APIRouter

from .. import __version__
from ..models import HealthResponse
from ..services.pencil_service import pencil_service

router = APIRouter(tags=["Health"])


@router.get("/", response_model=dict[str, Any])
async def root():
    """Root endpoint with API information."""
    return {
        "name": "Tale Designer API",
        "version": __version__,
        "description": "AI-powered document transformation service for Tale",
        "docs": "/docs",
        "health": "/health",
    }


@router.get("/health", response_model=HealthResponse)
async def health():
    """Health check endpoint."""
    return HealthResponse(
        status="healthy" if pencil_service.initialized else "degraded",
        version=__version__,
        initialized=pencil_service.initialized,
    )

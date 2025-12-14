"""Main FastAPI application for Tale RAG service."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from loguru import logger

from . import __version__
from .config import settings
from .models import ErrorResponse
from .routers import health_router, documents_router, search_router, jobs_router
from .services.cognee import cognee_service
from .utils import cleanup_memory


# Configure logging
logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle manager for the application."""
    # Startup
    logger.info("Starting Tale RAG service...")
    logger.info(f"Version: {__version__}")
    logger.info(f"Host: {settings.host}:{settings.port}")
    logger.info(f"Log level: {settings.log_level}")

    try:
        # Initialize cognee
        await cognee_service.initialize()
        logger.info("Cognee initialized successfully")
    except Exception:
        logger.exception("Failed to initialize cognee")
        # Continue anyway - some endpoints may still work

    yield

    # Shutdown
    logger.info("Shutting down Tale RAG service...")



# Create FastAPI application
app = FastAPI(
    title="Tale RAG API",
    description="Retrieval-Augmented Generation service using cognee",
    version=__version__,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)


# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.get_allowed_origins_list(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def memory_cleanup_middleware(request: Request, call_next):
    """Middleware that runs basic memory cleanup after each HTTP request.

    This helps keep long-running RAG workers from accumulating unreachable
    Python objects over time. It does not guarantee RSS will shrink for every
    request, but it reduces long-term growth.
    """
    try:
        response = await call_next(request)
        return response
    finally:
        cleanup_memory(context=f"after request {request.url.path}")


# Exception handlers
@app.exception_handler(HTTPException)
async def http_exception_handler(_request, exc):
    """Handle HTTP exceptions."""
    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorResponse(
            error=exc.__class__.__name__,
            message=exc.detail,
        ).model_dump(),
    )


@app.exception_handler(Exception)
async def general_exception_handler(_request, exc):
    """Handle general exceptions."""
    logger.opt(exception=exc).error("Unhandled exception")
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=ErrorResponse(
            error=exc.__class__.__name__,
            message="Internal server error",
            details={"error": str(exc)} if settings.log_level.lower() == "debug" else None,
        ).model_dump(),
    )


# Include routers
app.include_router(health_router)
app.include_router(documents_router)
app.include_router(search_router)
app.include_router(jobs_router)

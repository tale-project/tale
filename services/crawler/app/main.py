"""
Tale Crawler Service

Independent web crawling service using Crawl4AI.
Provides REST API for website crawling, URL discovery, document conversion,
template generation, and file parsing.

This module follows Clean Architecture principles:
- main.py: Application setup, configuration, and router registration
- routers/: Domain-specific API endpoints
- services: Business logic and external integrations
- models: Data transfer objects (DTOs) and request/response schemas
"""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from app import __version__
from app.config import settings
from app.models import HealthResponse
from app.routers import (
    crawler_router,
    docx_router,
    image_router,
    pdf_router,
    pptx_router,
)
from app.services.crawler_service import get_crawler_service
from app.services.image_service import get_image_service
from app.services.pdf_service import get_pdf_service


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator:
    """Lifespan context manager for startup and shutdown events."""
    # Startup
    logger.info(f"Starting Tale Crawler service v{__version__}...")
    logger.info(f"Server: {settings.host}:{settings.port}")
    logger.info(f"Log level: {settings.log_level}")

    # Initialize crawler service
    try:
        crawler = get_crawler_service()
        await crawler.initialize()
        logger.info("Crawler service initialized successfully")
    except Exception:
        logger.exception("Failed to initialize crawler service")
        # Don't fail startup - allow lazy initialization

    yield

    # Shutdown
    logger.info("Shutting down Tale Crawler service...")

    # Cleanup crawler service
    try:
        crawler = get_crawler_service()
        if crawler.initialized:
            await crawler.cleanup()
            logger.info("Crawler service cleaned up")
    except Exception:
        logger.exception("Failed to cleanup crawler service")


# Create FastAPI application
app = FastAPI(
    title="Tale Crawler API",
    description="Independent web crawling service using Crawl4AI",
    version=__version__,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.allowed_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Register routers
app.include_router(crawler_router)
app.include_router(pdf_router)
app.include_router(image_router)
app.include_router(docx_router)
app.include_router(pptx_router)


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    crawler = get_crawler_service()
    pdf_service = get_pdf_service()
    image_service = get_image_service()
    return HealthResponse(
        status="healthy",
        version=__version__,
        crawler_initialized=crawler.initialized,
        pdf_service_initialized=pdf_service.initialized,
        image_service_initialized=image_service.initialized,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        workers=settings.workers,
        log_level=settings.log_level,
    )


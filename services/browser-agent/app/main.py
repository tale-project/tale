"""
Tale Browser Agent Service

AI-powered browser automation service using OpenCode + Playwright MCP.
Provides REST API for web search and browser task automation.

Architecture:
- OpenCode CLI: Open-source AI coding agent with native MCP support
- Playwright MCP: Browser automation via Model Context Protocol
- Vision MCP: Image analysis using vision-capable LLMs
"""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from app import __version__
from app.config import settings
from app.models import HealthResponse
from app.routers import browser_router
from app.services import get_browser_service


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator:
    """Lifespan context manager for startup and shutdown events."""
    # Startup
    logger.info(f"Starting Tale Browser Agent service v{__version__}...")
    logger.info(f"Server: {settings.host}:{settings.port}")
    logger.info(f"Log level: {settings.log_level}")
    logger.info(f"Headless mode: {settings.headless}")
    logger.info(f"LLM model: {settings.openai_model} (via OpenCode)")

    # Initialize browser service (lazy - will init on first request)
    try:
        service = get_browser_service()
        await service.initialize()
        logger.info("Browser service initialized successfully")
    except Exception:
        logger.exception("Failed to initialize browser service")
        # Don't fail startup - allow lazy initialization

    yield

    # Shutdown
    logger.info("Shutting down Tale Browser Agent service...")

    # Cleanup browser service
    try:
        service = get_browser_service()
        if service.initialized:
            await service.cleanup()
            logger.info("Browser service cleaned up")
    except Exception:
        logger.exception("Failed to cleanup browser service")


# Create FastAPI application
app = FastAPI(
    title="Tale Browser Agent API",
    description="AI-powered browser automation service using OpenCode + Playwright MCP",
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
app.include_router(browser_router)


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    service = get_browser_service()
    return HealthResponse(
        status="healthy",
        version=__version__,
        browser_initialized=service.initialized,
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

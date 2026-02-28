"""Main FastAPI application for Tale RAG service."""

import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from loguru import logger

from . import __version__
from .config import settings
from .models import ErrorResponse
from .routers import documents_router, health_router, jobs_router, search_router
from .services.database import close_pool
from .services.rag_service import rag_service
from .utils import cleanup_memory

# Configure logging
logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)


async def periodic_gc_cleanup() -> None:
    """Background task: perform GC cleanup every 60 seconds."""
    while True:
        try:
            await asyncio.sleep(60)
            cleanup_memory(context="periodic cleanup")
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Error in periodic GC cleanup")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle manager for the application."""
    logger.info("Starting Tale RAG service...")
    logger.info(f"Version: {__version__}")
    logger.info(f"Host: {settings.host}:{settings.port}")
    logger.info(f"Log level: {settings.log_level}")

    try:
        await rag_service.initialize()
        logger.info("RAG service initialized")
    except Exception:
        logger.exception("Failed to initialize RAG service")

    # Initialize job store (uses the shared pool from rag_service)
    try:
        from .services import job_store_db

        await job_store_db.init_job_store()
        logger.info("Job store initialized")
    except Exception:
        logger.exception("Failed to initialize job store")

    # Job cleanup on startup
    if settings.job_cleanup_on_startup:
        try:
            from .services import job_store_db

            result = await job_store_db.cleanup_stale_jobs()
            if result["deleted"] > 0:
                logger.info(f"Cleaned up {result['deleted']} stale jobs on startup: {result['by_reason']}")
        except Exception:
            logger.exception("Failed to cleanup stale jobs on startup")

    # Start periodic GC cleanup task
    gc_task = asyncio.create_task(periodic_gc_cleanup())

    def _on_gc_task_done(task: asyncio.Task) -> None:
        try:
            task.result()
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception("Periodic GC cleanup task died unexpectedly")

    gc_task.add_done_callback(_on_gc_task_done)
    logger.info("Started periodic GC cleanup task (60s interval)")

    yield

    # Shutdown
    gc_task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await gc_task

    await rag_service.shutdown()
    await close_pool()
    logger.info("Shutting down Tale RAG service...")


# Create FastAPI application
app = FastAPI(
    title="Tale RAG API",
    description="Retrieval-Augmented Generation service for Tale",
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

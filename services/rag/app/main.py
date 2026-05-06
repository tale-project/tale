"""Main FastAPI application for Tale RAG service."""

import asyncio
import contextlib
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from loguru import logger
from tale_shared.logging import suppress_health_check_logs
from tale_telemetry import init_telemetry, shutdown_telemetry

from . import __version__
from .auth import verify_internal_token, warn_if_default_token_in_use
from .config import settings
from .models import ErrorResponse
from .routers.documents import router as documents_router
from .routers.health import (
    protected_router as health_protected_router,
)
from .routers.health import (
    public_router as health_public_router,
)
from .routers.search import router as search_router
from .services.rag_service import rag_service
from .utils import cleanup_memory


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
    # Startup
    suppress_health_check_logs()
    logger.info("Starting Tale RAG service...")
    logger.info("Version: {}", __version__)
    logger.info("Host: {}:{}", settings.host, settings.port)
    logger.info("Log level: {}", settings.log_level)

    # Emit SECURITY warning if the baked-in default internal token is in use.
    # If RAG_REQUIRE_CUSTOM_INTERNAL_TOKEN=true this raises and stops startup.
    warn_if_default_token_in_use()

    try:
        await rag_service.initialize()
        logger.info("RAG service initialized")
    except Exception:
        logger.exception("Failed to initialize RAG service")

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
    shutdown_telemetry()
    logger.info("Shutting down Tale RAG service...")


# Create FastAPI application.
# `/docs`, `/redoc`, `/openapi.json` are mounted at the FastAPI app level
# (outside any router), so per-router `dependencies=` can't gate them.
# Disable in non-debug builds — they leak the entire authenticated API
# surface, helping a token-brute-forcer / replay attacker.
_in_debug_mode = settings.log_level.lower() == "debug"
app = FastAPI(
    title="Tale RAG API",
    description="Retrieval-Augmented Generation service for Tale",
    version=__version__,
    lifespan=lifespan,
    docs_url="/docs" if _in_debug_mode else None,
    redoc_url="/redoc" if _in_debug_mode else None,
    openapi_url="/openapi.json" if _in_debug_mode else None,
)


# Add CORS middleware. `allow_credentials=True` with `allow_origins=["*"]`
# is a spec-invalid combo (Starlette degrades to reflecting `Origin`),
# and we're not cookie-borne anyway — the bearer token rides explicit
# `Authorization` headers — so flip credentials off to get a real
# allowlist behavior.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.get_allowed_origins_list(),
    allow_credentials=False,
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
            error=exc.__class__.__name__ if settings.log_level.lower() == "debug" else "InternalServerError",
            message="Internal server error",
            details={"error": str(exc)} if settings.log_level.lower() == "debug" else None,
        ).model_dump(),
    )


# Include routers.
# `health_public_router` (`/`, `/health`) stays unauthenticated so liveness
# and readiness probes (docker / k8s) work without auth headers.
# `health_protected_router` (`/config`) and every other router require
# `Authorization: Bearer ${RAG_INTERNAL_TOKEN}`.
app.include_router(health_public_router)
app.include_router(health_protected_router, dependencies=[Depends(verify_internal_token)])
app.include_router(documents_router, dependencies=[Depends(verify_internal_token)])
app.include_router(search_router, dependencies=[Depends(verify_internal_token)])
init_telemetry(app)


@app.get("/", include_in_schema=False)
async def root() -> dict[str, str]:
    """Root endpoint — exempt from auth so liveness probes can hit it."""
    return {"service": "tale-rag", "version": __version__, "status": "ok"}

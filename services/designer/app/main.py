"""Main FastAPI application for Tale Designer service."""

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from loguru import logger
from tale_telemetry import init_telemetry, shutdown_telemetry

from . import __version__
from .config import settings
from .models import ErrorResponse
from .routers import health_router, transform_router
from .services.pencil_service import pencil_service


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle manager for the application."""
    logger.info("Starting Tale Designer service...")
    logger.info("Version: {}", __version__)
    logger.info("Host: {}:{}", settings.host, settings.port)
    logger.info("Log level: {}", settings.log_level)

    await pencil_service.initialize()

    yield

    await pencil_service.shutdown()
    shutdown_telemetry()
    logger.info("Shutting down Tale Designer service...")


app = FastAPI(
    title="Tale Designer API",
    description="AI-powered document transformation service for Tale",
    version=__version__,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.get_allowed_origins_list(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(HTTPException)
async def http_exception_handler(_request, exc):
    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorResponse(
            error=exc.__class__.__name__,
            message=exc.detail,
        ).model_dump(),
    )


@app.exception_handler(Exception)
async def general_exception_handler(_request, exc):
    logger.opt(exception=exc).error("Unhandled exception")
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=ErrorResponse(
            error=exc.__class__.__name__ if settings.log_level.lower() == "debug" else "InternalServerError",
            message="Internal server error",
            details={"error": str(exc)} if settings.log_level.lower() == "debug" else None,
        ).model_dump(),
    )


app.include_router(health_router)
app.include_router(transform_router)
init_telemetry(app)

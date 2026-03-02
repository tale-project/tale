"""
Tale Crawler Service

Independent web crawling service using Crawl4AI.
Provides REST API for website crawling, URL discovery, document conversion,
template generation, file parsing, content indexing, and hybrid search.

This module follows Clean Architecture principles:
- main.py: Application setup, configuration, and router registration
- routers/: Domain-specific API endpoints
- services: Business logic and external integrations
- models: Data transfer objects (DTOs) and request/response schemas
"""

import asyncio
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger
from tale_telemetry import init_telemetry, shutdown_telemetry

from app import __version__
from app.config import settings
from app.models import HealthResponse
from app.routers import (
    crawler_router,
    docx_router,
    image_router,
    index_router,
    pages_router,
    pdf_router,
    pptx_router,
    search_router,
    web_router,
    websites_router,
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
    logger.info(
        f"Config: scans={settings.max_concurrent_scans}, "
        f"poll={settings.poll_interval}s, batch={settings.crawl_batch_size}, "
        f"browser_restart={settings.crawl_count_before_restart}, "
        f"db_pool={settings.db_pool_max_size}"
    )

    # Initialize crawler service
    try:
        crawler = get_crawler_service(
            crawl_count_before_restart=settings.crawl_count_before_restart,
        )
        await crawler.initialize()
        logger.info("Crawler service initialized successfully")
    except Exception:
        logger.exception("Failed to initialize crawler service")

    # Initialize PostgreSQL connection pool + search services
    from app.services.database import close_pool, init_pool
    from app.services.embedding_service import get_embedding_service
    from app.services.indexing_service import IndexingService
    from app.services.pg_website_store import PgWebsiteStoreManager
    from app.services.scheduler import run_scheduler
    from app.services.search_service import SearchService

    pool = await init_pool(max_size=settings.db_pool_max_size)
    pg_store_manager = PgWebsiteStoreManager(pool)
    embedding_service = get_embedding_service()
    indexing_service = IndexingService(pool, embedding_service)
    search_service = SearchService(pool, embedding_service)

    # Wire services into routers
    from app.routers.index import set_indexing_service
    from app.routers.search import set_search_service

    set_search_service(search_service)
    set_indexing_service(indexing_service)

    # Store references for scheduler and other routers
    app.state.pg_store_manager = pg_store_manager
    app.state.indexing_service = indexing_service

    logger.info("PostgreSQL pool + search services initialized")

    # Resume any deletions interrupted by a previous crash
    from app.routers.websites import _spawn_delete_task

    stuck = await pg_store_manager.recover_stuck_deletes()
    for domain in stuck:
        logger.warning(f"Resuming stuck deletion for {domain}")
        _spawn_delete_task(pg_store_manager, domain)
    if stuck:
        logger.info(f"Re-enqueued {len(stuck)} stuck deletion(s)")

    # Start background scheduler
    scheduler_task = asyncio.create_task(
        run_scheduler(
            pg_store_manager,
            get_crawler_service(),
            indexing_service,
            max_concurrent_scans=settings.max_concurrent_scans,
            poll_interval=settings.poll_interval,
            crawl_batch_size=settings.crawl_batch_size,
        )
    )
    logger.info("Background scheduler started")

    yield

    # Shutdown
    logger.info("Shutting down Tale Crawler service...")

    scheduler_task.cancel()
    with suppress(asyncio.CancelledError):
        await scheduler_task
    logger.info("Scheduler stopped")

    # Wait for any in-flight background deletions to finish
    from app.routers.websites import get_delete_tasks

    delete_tasks = get_delete_tasks()
    if delete_tasks:
        logger.info(f"Waiting for {len(delete_tasks)} background deletion(s)...")
        await asyncio.gather(*delete_tasks, return_exceptions=True)
        logger.info("Background deletions finished")

    await pg_store_manager.close()
    await close_pool()

    try:
        crawler = get_crawler_service()
        if crawler.initialized:
            await crawler.cleanup()
            logger.info("Crawler service cleaned up")
    except Exception:
        logger.exception("Failed to cleanup crawler service")

    shutdown_telemetry()


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

init_telemetry(app)


# Register routers
app.include_router(crawler_router)
app.include_router(websites_router)
app.include_router(search_router)
app.include_router(pages_router)
app.include_router(index_router)
app.include_router(pdf_router)
app.include_router(image_router)
app.include_router(docx_router)
app.include_router(pptx_router)
app.include_router(web_router)


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

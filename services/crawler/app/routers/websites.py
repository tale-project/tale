"""
Websites Router — Website registration and URL listing endpoints.
"""

import asyncio
import hashlib
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from loguru import logger

from app.models import RegisterWebsiteRequest, WebsiteInfoResponse, WebsiteUrl, WebsiteUrlsResponse
from app.services.crawler_service import get_crawler_service
from app.services.pg_website_store import PgWebsiteStoreManager
from app.services.scheduler import cancel_scan, trigger_scan
from app.utils.metadata import extract_meta_description
from app.utils.structured_data import format_structured_data

router = APIRouter(prefix="/api/v1/websites", tags=["Websites"])

_delete_sem = asyncio.Semaphore(3)
_delete_tasks: set[asyncio.Task] = set()


async def _background_delete(manager: PgWebsiteStoreManager, domain: str) -> None:
    """Run CASCADE DELETE in a bounded background task."""
    async with _delete_sem:
        try:
            await manager.execute_delete(domain)
        except Exception:
            logger.exception(f"Background delete failed for {domain}")
            try:
                await manager.update_scan_status(domain, "error", "Delete failed")
            except Exception:
                logger.exception(f"Failed to set error status for {domain}")


def _spawn_delete_task(manager: PgWebsiteStoreManager, domain: str) -> None:
    """Create a tracked background delete task."""

    def _on_done(t: asyncio.Task) -> None:
        _delete_tasks.discard(t)
        if not t.cancelled() and (exc := t.exception()):
            logger.error(f"Background delete task error for {domain}: {exc}")

    task = asyncio.create_task(_background_delete(manager, domain))
    _delete_tasks.add(task)
    task.add_done_callback(_on_done)


def get_delete_tasks() -> set[asyncio.Task]:
    """Expose tracked delete tasks for graceful shutdown."""
    return _delete_tasks


def _get_manager(request: Request) -> PgWebsiteStoreManager:
    return request.app.state.pg_store_manager


def _format_timestamp(val) -> str | None:
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.isoformat()
    if isinstance(val, (int, float)):
        return datetime.fromtimestamp(val, tz=UTC).isoformat()
    return str(val)


async def _initialize_website(domain: str, manager: PgWebsiteStoreManager):
    """Background task: crawl homepage + discover URLs concurrently."""
    crawler_service = get_crawler_service()
    if not crawler_service.initialized:
        await crawler_service.initialize()

    site_store = manager.get_site_store(domain)

    async def _crawl_homepage():
        homepage_url = f"https://{domain}/"
        try:
            results = await crawler_service.crawl_urls(urls=[homepage_url])
            if not results:
                return
            page = results[0]
            if page.get("content") is None:
                return
            title = page.get("title")
            structured_data = page.get("structured_data")
            description = extract_meta_description(structured_data)

            content = page["content"]
            sd_text = format_structured_data(structured_data)
            if sd_text:
                content = f"{content}\n\n{sd_text}"

            await site_store.save_discovered_urls([{"url": homepage_url}])
            await site_store.update_content_hashes(
                [
                    {
                        "url": homepage_url,
                        "content_hash": hashlib.sha256(content.encode()).hexdigest(),
                        "status": "active",
                        "title": title,
                        "content": content,
                        "word_count": len(content.split()),
                        "metadata": page.get("metadata"),
                        "structured_data": structured_data,
                    }
                ]
            )
            await manager.update_website_metadata(
                domain=domain,
                title=title,
                description=description,
                page_count=1,
            )
        except Exception:
            logger.exception(f"Failed to crawl homepage for {domain}")

    async def _discover_urls():
        try:
            discovered = await crawler_service.discover_urls(domain=domain, max_urls=-1)
            if discovered:
                await site_store.save_discovered_urls(discovered)
                logger.info(f"Discovered {len(discovered)} URLs for {domain}")
        except Exception:
            logger.exception(f"URL discovery failed for {domain}")

    await asyncio.gather(_crawl_homepage(), _discover_urls())

    await manager.update_last_scanned(domain)
    await manager.update_scan_status(domain, "active")


@router.post("", response_model=WebsiteInfoResponse)
async def register_website(request: RegisterWebsiteRequest, http_request: Request):
    try:
        manager = _get_manager(http_request)

        # Reject registration if domain is currently being deleted
        website = await manager.get_website(request.domain)
        if website and website.get("status") == "deleting":
            raise HTTPException(
                status_code=409,
                detail=f"Domain {request.domain} is currently being deleted. Please retry later.",
            )

        await manager.register_website(
            domain=request.domain,
            scan_interval=request.scan_interval,
        )

        # Fire-and-forget: crawl homepage + discover URLs concurrently in background
        def _on_init_done(t: asyncio.Task) -> None:
            if not t.cancelled() and (exc := t.exception()):
                logger.error(f"Website initialization failed for {request.domain}: {exc}")

        task = asyncio.create_task(_initialize_website(request.domain, manager))
        task.add_done_callback(_on_init_done)
        trigger_scan()

        return WebsiteInfoResponse(
            domain=request.domain,
            status="scanning",
            scan_interval=request.scan_interval,
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Error registering website")
        raise HTTPException(status_code=500, detail="Failed to register website") from None


@router.get("/{domain}", response_model=WebsiteInfoResponse)
async def get_website_info(domain: str, http_request: Request):
    try:
        manager = _get_manager(http_request)
        website = await manager.get_website(domain)

        if not website:
            raise HTTPException(status_code=404, detail=f"Website not found: {domain}")

        return WebsiteInfoResponse(
            domain=website["domain"],
            title=website.get("title"),
            description=website.get("description"),
            page_count=website.get("total_urls", 0),
            crawled_count=website.get("crawled_count", 0),
            status=website.get("status", "idle"),
            scan_interval=website.get("scan_interval", 21600),
            last_scanned_at=_format_timestamp(website.get("last_scanned_at")),
            error=website.get("error"),
            created_at=_format_timestamp(website.get("created_at")),
            updated_at=_format_timestamp(website.get("updated_at")),
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Error getting website info")
        raise HTTPException(status_code=500, detail="Failed to get website info") from None


@router.delete("/{domain}")
async def deregister_website(domain: str, http_request: Request):
    try:
        cancel_scan(domain)
        manager = _get_manager(http_request)
        marked = await manager.begin_delete(domain)
        if not marked:
            # Already deleting — return 202 idempotently
            website = await manager.get_website(domain)
            if website and website.get("status") == "deleting":
                return JSONResponse(
                    status_code=202,
                    content={"domain": domain, "status": "deleting"},
                )
            raise HTTPException(status_code=404, detail=f"Website not found: {domain}")

        _spawn_delete_task(manager, domain)
        return JSONResponse(
            status_code=202,
            content={"domain": domain, "status": "deleting"},
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Error deregistering website")
        raise HTTPException(status_code=500, detail="Failed to deregister website") from None


@router.get("/{domain}/urls", response_model=WebsiteUrlsResponse)
async def get_website_urls(
    domain: str,
    http_request: Request,
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    status: str | None = Query(None),
):
    try:
        manager = _get_manager(http_request)
        website = await manager.get_website(domain)

        if not website:
            raise HTTPException(status_code=404, detail=f"Website not found: {domain}")

        site_store = manager.get_site_store(domain)
        urls_data = await site_store.get_urls_page(offset=offset, limit=limit, status=status)
        total = await site_store.get_total_count(status=status)

        urls = [
            WebsiteUrl(
                url=u["url"],
                content_hash=u["content_hash"],
                status=u["status"],
                last_crawled_at=u["last_crawled_at"],
            )
            for u in urls_data
        ]

        return WebsiteUrlsResponse(
            domain=domain,
            urls=urls,
            total=total,
            offset=offset,
            has_more=offset + limit < total,
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Error getting website URLs")
        raise HTTPException(status_code=500, detail="Failed to get website URLs") from None

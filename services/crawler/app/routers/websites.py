"""
Websites Router — Website registration and URL listing endpoints.
"""

import asyncio
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from loguru import logger

from app.models import (
    RegisterWebsiteRequest,
    UpdateWebsiteRequest,
    WebsiteInfoResponse,
    WebsiteUrl,
    WebsiteUrlsResponse,
)
from app.org_context import get_active_org
from app.services.pg_website_store import PgWebsiteStoreManager
from app.services.scheduler import cancel_scan, trigger_scan

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


@router.post("", response_model=WebsiteInfoResponse)
async def register_website(request: RegisterWebsiteRequest, http_request: Request):
    try:
        manager = _get_manager(http_request)
        org_slug = get_active_org()

        # Reject registration if domain is currently being deleted
        website = await manager.get_website(request.domain)
        if website and website.get("status") == "deleting":
            raise HTTPException(
                status_code=409,
                detail=f"Domain {request.domain} is currently being deleted. Please retry later.",
            )

        result = await manager.register_website(
            domain=request.domain,
            scan_interval=request.scan_interval,
            org_slug=org_slug,
        )

        # Wake the scheduler only when this membership creates new work
        # (first org to register this domain). Subsequent orgs joining an
        # already-tracked domain reuse the existing crawl cadence.
        if result.get("first_membership"):
            trigger_scan()

        # Echo the *stored* scan_interval, not the request's. ON CONFLICT
        # preserves the existing cadence (P1-22 / round-3 P1) so the second
        # org to register a domain with a different cadence would otherwise
        # be told their value was accepted when in fact the first org's
        # cadence remains in force.
        stored_interval = int(
            result.get("scan_interval", request.scan_interval),
        )
        return WebsiteInfoResponse(
            domain=request.domain,
            status="scanning"
            if result.get("first_membership")
            else (website.get("status") if website else result.get("status", "idle")),
            scan_interval=stored_interval,
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Error registering website")
        raise HTTPException(status_code=500, detail="Failed to register website") from None


@router.patch("/{domain}", response_model=WebsiteInfoResponse)
async def update_website(domain: str, request: UpdateWebsiteRequest, http_request: Request):
    try:
        manager = _get_manager(http_request)
        org_slug = get_active_org()
        # Caller's org must have a membership on this domain or it doesn't
        # exist (from their viewpoint).
        if not await manager.org_has_membership(domain, org_slug):
            raise HTTPException(status_code=404, detail=f"Website not found: {domain}")
        website = await manager.get_website(domain)
        if not website:
            raise HTTPException(status_code=404, detail=f"Website not found: {domain}")
        if website.get("status") == "deleting":
            raise HTTPException(
                status_code=409,
                detail=f"Domain {domain} is currently being deleted. Please retry later.",
            )

        await manager.update_scan_interval(domain=domain, scan_interval=request.scan_interval)

        return WebsiteInfoResponse(
            domain=domain,
            title=website.get("title"),
            description=website.get("description"),
            page_count=website.get("total_urls", 0),
            crawled_count=website.get("crawled_count", 0),
            status=website.get("status", "idle"),
            scan_interval=request.scan_interval,
            last_scanned_at=_format_timestamp(website.get("last_scanned_at")),
            error=website.get("error"),
            created_at=_format_timestamp(website.get("created_at")),
            updated_at=_format_timestamp(website.get("updated_at")),
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Error updating website")
        raise HTTPException(status_code=500, detail="Failed to update website") from None


@router.get("/{domain}", response_model=WebsiteInfoResponse)
async def get_website_info(domain: str, http_request: Request):
    try:
        manager = _get_manager(http_request)
        org_slug = get_active_org()
        if not await manager.org_has_membership(domain, org_slug):
            raise HTTPException(status_code=404, detail=f"Website not found: {domain}")
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
        manager = _get_manager(http_request)
        org_slug = get_active_org()

        result = await manager.begin_delete(domain, org_slug)
        if not result["removed_membership"]:
            # The caller's org wasn't tracking this domain. From their
            # viewpoint, the website doesn't exist — return 404 instead
            # of leaking whether another org has it.
            raise HTTPException(status_code=404, detail=f"Website not found: {domain}")

        if not result["removed_website"]:
            # Other orgs are still using this domain; only the caller's
            # membership was removed. Domain data stays in place.
            return JSONResponse(
                status_code=200,
                content={"domain": domain, "status": "membership_removed"},
            )

        # We dropped the last membership and the website was marked for
        # deletion. Cancel any in-flight scan and start the CASCADE in
        # the background.
        cancel_scan(domain)
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
        org_slug = get_active_org()
        if not await manager.org_has_membership(domain, org_slug):
            raise HTTPException(status_code=404, detail=f"Website not found: {domain}")
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

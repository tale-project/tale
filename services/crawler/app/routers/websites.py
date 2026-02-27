"""
Websites Router — Website registration and URL listing endpoints.
"""

from fastapi import APIRouter, HTTPException, Query
from loguru import logger

from app.models import RegisterWebsiteRequest, WebsiteUrl, WebsiteUrlsResponse
from app.services.scheduler import trigger_scan
from app.services.website_store import get_website_store_manager

router = APIRouter(prefix="/api/v1/websites", tags=["Websites"])


@router.post("")
async def register_website(request: RegisterWebsiteRequest):
    try:
        manager = get_website_store_manager()
        result = manager.register_website(
            url=request.url,
            scan_interval=request.scan_interval,
        )
        trigger_scan()
        return result
    except Exception:
        logger.exception("Error registering website")
        raise HTTPException(status_code=500, detail="Failed to register website") from None


@router.delete("")
async def deregister_website(url: str = Query(..., description="The registered base URL to remove")):
    try:
        manager = get_website_store_manager()
        deleted = manager.remove_website(url)
        if not deleted:
            raise HTTPException(status_code=404, detail=f"Website not found: {url}")
        return {"url": url, "deleted": True}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Error deregistering website")
        raise HTTPException(status_code=500, detail="Failed to deregister website") from None


@router.get("/urls", response_model=WebsiteUrlsResponse)
async def get_website_urls(
    url: str = Query(..., description="The registered base URL"),
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    status: str | None = Query(None),
):
    try:
        manager = get_website_store_manager()
        website = manager.get_website(url)
        if not website:
            raise HTTPException(status_code=404, detail=f"Website not found: {url}")

        site_store = manager.get_site_store(url)
        urls_data = site_store.get_urls_page(offset=offset, limit=limit, status=status)
        total = site_store.get_total_count(status=status)

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
            url=website["url"],
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

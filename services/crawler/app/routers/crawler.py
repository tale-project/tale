"""
Crawler Router - Content fetching and URL check endpoints.
"""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request
from loguru import logger
from pydantic import HttpUrl

from app.models import (
    FetchUrlsRequest,
    FetchUrlsResponse,
    PageContent,
)
from app.services.crawler_service import get_crawler_service

router = APIRouter(prefix="/api/v1/urls", tags=["Crawler"])


@router.post("/fetch", response_model=FetchUrlsResponse)
async def fetch_urls(request: FetchUrlsRequest, http_request: Request):
    """
    Fetch content from a list of specific URLs.

    Returns cached content when available from the per-site content store,
    falling back to live crawling for cache misses.
    """
    try:
        store_manager = http_request.app.state.pg_store_manager
        cached, urls_to_crawl = await store_manager.get_cached_pages(request.urls)

        # Filter cached pages by word_count_threshold
        threshold = request.word_count_threshold
        cached = [p for p in cached if p.get("word_count", 0) >= threshold]

        crawled_pages: list[dict] = []
        if urls_to_crawl:
            crawler = get_crawler_service()
            if not crawler.initialized:
                await crawler.initialize()
            crawled_pages = await crawler.crawl_urls(
                urls=urls_to_crawl,
                word_count_threshold=threshold,
            )
            crawled_pages = [p for p in crawled_pages if p.get("content") is not None]

        if cached:
            logger.info(f"Served {len(cached)} pages from cache, crawled {len(crawled_pages)} live")

        pages = [
            PageContent(
                url=page["url"],
                title=page.get("title"),
                content=page["content"],
                word_count=page.get("word_count", 0),
                metadata=page.get("metadata"),
                structured_data=page.get("structured_data"),
            )
            for page in cached + crawled_pages
        ]

        return FetchUrlsResponse(
            success=True,
            urls_requested=len(request.urls),
            urls_fetched=len(pages),
            pages=pages,
        )

    except Exception:
        logger.exception("Error fetching URLs")
        raise HTTPException(
            status_code=500,
            detail="Failed to fetch URLs",
        ) from None


@router.get("/check")
async def check_url(
    url: Annotated[HttpUrl, Query(description="The URL to check")],
):
    """
    Check if a URL is a website or a single document.
    """
    try:
        crawler = get_crawler_service()
        url_str = str(url)
        is_website = crawler.is_website_url(url_str)

        return {
            "url": url_str,
            "is_website": is_website,
        }

    except Exception:
        logger.exception("Error checking URL")
        raise HTTPException(
            status_code=500,
            detail="Failed to check URL",
        ) from None

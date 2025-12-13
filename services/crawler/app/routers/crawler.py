"""
Crawler Router - URL discovery and content fetching endpoints.
"""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from loguru import logger
from pydantic import HttpUrl

from app.models import (
    DiscoverRequest,
    DiscoverResponse,
    DiscoveredUrl,
    FetchUrlsRequest,
    FetchUrlsResponse,
    PageContent,
)
from app.services.crawler_service import get_crawler_service

router = APIRouter(prefix="/api/v1/urls", tags=["Crawler"])


@router.post("/discover", response_model=DiscoverResponse)
async def discover_urls(request: DiscoverRequest):
    """
    Discover URLs on a website using sitemaps and Common Crawl.

    This endpoint discovers URLs without crawling their content.
    Useful for previewing what will be crawled.

    Args:
        request: Discovery request with domain and options

    Returns:
        Discovery response with discovered URLs
    """
    try:
        crawler = get_crawler_service()

        # Ensure crawler is initialized
        if not crawler.initialized:
            await crawler.initialize()

        # Discover URLs
        discovered = await crawler.discover_urls(
            domain=request.domain,
            max_urls=request.max_urls,
            pattern=request.pattern,
            query=request.query,
            timeout=request.timeout or 1800.0,
        )

        # Convert to response model
        urls = [
            DiscoveredUrl(
                url=url_data["url"],
                status=url_data.get("status", "unknown"),
                metadata=url_data,
            )
            for url_data in discovered
        ]

        return DiscoverResponse(
            success=True,
            domain=request.domain,
            urls_discovered=len(urls),
            urls=urls,
        )

    except Exception:
        logger.exception("Error discovering URLs")
        raise HTTPException(
            status_code=500,
            detail="Failed to discover URLs",
        ) from None


@router.post("/fetch", response_model=FetchUrlsResponse)
async def fetch_urls(request: FetchUrlsRequest):
    """
    Fetch content from a list of specific URLs.

    This endpoint takes a list of URLs and fetches their content without
    performing URL discovery. Useful when you already know which URLs
    you want to crawl.

    Args:
        request: Fetch request with list of URLs and options

    Returns:
        Fetch response with content from each URL
    """
    try:
        crawler = get_crawler_service()

        # Ensure crawler is initialized
        if not crawler.initialized:
            await crawler.initialize()

        # Crawl the provided URLs
        crawled_pages = await crawler.crawl_urls(
            urls=request.urls,
            word_count_threshold=request.word_count_threshold,
        )

        # Convert to response model
        pages = [
            PageContent(
                url=page["url"],
                title=page.get("title"),
                content=page["content"],
                word_count=page["word_count"],
                metadata=page.get("metadata"),
                structured_data=page.get("structured_data"),
            )
            for page in crawled_pages
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

    Args:
        url: The URL to check (must be a valid HTTP/HTTPS URL)

    Returns:
        Dictionary with is_website boolean
    """
    try:
        crawler = get_crawler_service()
        # Convert HttpUrl to string for the crawler service
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

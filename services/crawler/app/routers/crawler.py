"""
Crawler Router - URL discovery and content fetching endpoints.
"""

from fastapi import APIRouter, HTTPException
from loguru import logger

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

    except Exception as e:
        logger.error(f"Error discovering URLs: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to discover URLs: {str(e)}",
        )


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

    except Exception as e:
        logger.error(f"Error fetching URLs: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch URLs: {str(e)}",
        )


@router.get("/check")
async def check_url(url: str):
    """
    Check if a URL is a website or a single document.

    Args:
        url: The URL to check

    Returns:
        Dictionary with is_website boolean
    """
    try:
        crawler = get_crawler_service()
        is_website = crawler.is_website_url(url)

        return {
            "url": url,
            "is_website": is_website,
        }

    except Exception as e:
        logger.error(f"Error checking URL: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to check URL: {str(e)}",
        )

"""
Tale Crawler Service

Independent web crawling service using Crawl4AI.
Provides REST API for website crawling and URL discovery.
"""

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from app import __version__
from app.config import settings
from fastapi.responses import Response
from app.models import (
    CrawlRequest,
    CrawlResponse,
    DiscoverRequest,
    DiscoverResponse,
    DiscoveredUrl,
    PageContent,
    FetchUrlsRequest,
    FetchUrlsResponse,
    HealthResponse,
    MarkdownToPdfRequest,
    MarkdownToImageRequest,
    HtmlToPdfRequest,
    HtmlToImageRequest,
    UrlToPdfRequest,
    UrlToImageRequest,
)
from app.crawler_service import get_crawler_service
from app.converter_service import get_converter_service


# Configure logging
logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator:
    """Lifespan context manager for startup and shutdown events."""
    # Startup
    logger.info(f"Starting Tale Crawler service v{__version__}...")
    logger.info(f"Server: {settings.host}:{settings.port}")
    logger.info(f"Log level: {settings.log_level}")

    # Initialize crawler service
    try:
        crawler = get_crawler_service()
        await crawler.initialize()
        logger.info("Crawler service initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize crawler service: {e}")
        # Don't fail startup - allow lazy initialization

    yield

    # Shutdown
    logger.info("Shutting down Tale Crawler service...")

    # Cleanup crawler service
    try:
        crawler = get_crawler_service()
        if crawler.initialized:
            await crawler.cleanup()
            logger.info("Crawler service cleaned up")
    except Exception as e:
        logger.error(f"Failed to cleanup crawler service: {e}")


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
    allow_origins=settings.allowed_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    crawler = get_crawler_service()
    converter = get_converter_service()
    return HealthResponse(
        status="healthy",
        version=__version__,
        crawler_initialized=crawler.initialized,
        converter_initialized=converter.initialized,
    )


@app.post("/api/v1/crawl", response_model=CrawlResponse)
async def crawl_website(request: CrawlRequest):
    """
    Crawl an entire website: discover URLs and extract content.

    This endpoint:
    1. Discovers URLs on the website using sitemaps and Common Crawl
    2. Crawls discovered pages and extracts content
    3. Returns structured content for each page

    Args:
        request: Crawl request with URL and options

    Returns:
        Crawl response with discovered and crawled pages
    """
    try:
        crawler = get_crawler_service()

        # Ensure crawler is initialized
        if not crawler.initialized:
            await crawler.initialize()

        # Crawl the website
        result = await crawler.crawl_website(
            url=str(request.url),
            max_pages=request.max_pages,
            pattern=request.pattern,
            query=request.query,
            word_count_threshold=request.word_count_threshold,
            timeout=request.timeout or 1800.0,
        )

        if not result["success"]:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=result.get("error", "Unknown error"),
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
            for page in result["pages"]
        ]

        return CrawlResponse(
            success=True,
            domain=result["domain"],
            pages_discovered=result["pages_discovered"],
            pages_crawled=result["pages_crawled"],
            pages=pages,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error crawling website: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to crawl website: {str(e)}",
        )


@app.post("/api/v1/discover", response_model=DiscoverResponse)
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
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to discover URLs: {str(e)}",
        )


@app.post("/api/v1/fetch-urls", response_model=FetchUrlsResponse)
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
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch URLs: {str(e)}",
        )


@app.get("/api/v1/check-url")
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
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to check URL: {str(e)}",
        )


# ==================== Document Conversion Endpoints ====================


@app.post("/api/v1/convert/markdown-to-pdf")
async def convert_markdown_to_pdf(request: MarkdownToPdfRequest):
    """
    Convert Markdown content to PDF.

    Args:
        request: Markdown content and PDF options

    Returns:
        PDF file as binary response
    """
    try:
        converter = get_converter_service()
        if not converter.initialized:
            await converter.initialize()

        pdf_bytes = await converter.markdown_to_pdf(
            markdown=request.content,
            format=request.options.format,
            landscape=request.options.landscape,
            margin_top=request.options.margin_top,
            margin_bottom=request.options.margin_bottom,
            margin_left=request.options.margin_left,
            margin_right=request.options.margin_right,
            print_background=request.options.print_background,
            extra_css=request.extra_css,
        )

        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": "attachment; filename=document.pdf"},
        )

    except Exception as e:
        logger.error(f"Error converting markdown to PDF: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to convert markdown to PDF: {str(e)}",
        )


@app.post("/api/v1/convert/markdown-to-image")
async def convert_markdown_to_image(request: MarkdownToImageRequest):
    """
    Convert Markdown content to image (PNG or JPEG).

    Args:
        request: Markdown content and image options

    Returns:
        Image file as binary response
    """
    try:
        converter = get_converter_service()
        if not converter.initialized:
            await converter.initialize()

        image_bytes = await converter.markdown_to_image(
            markdown=request.content,
            image_type=request.options.image_type,
            quality=request.options.quality,
            full_page=request.options.full_page,
            width=request.options.width,
            extra_css=request.extra_css,
        )

        media_type = "image/png" if request.options.image_type == "png" else "image/jpeg"
        ext = request.options.image_type

        return Response(
            content=image_bytes,
            media_type=media_type,
            headers={"Content-Disposition": f"attachment; filename=document.{ext}"},
        )

    except Exception as e:
        logger.error(f"Error converting markdown to image: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to convert markdown to image: {str(e)}",
        )


@app.post("/api/v1/convert/html-to-pdf")
async def convert_html_to_pdf(request: HtmlToPdfRequest):
    """
    Convert HTML content to PDF.

    Args:
        request: HTML content and PDF options

    Returns:
        PDF file as binary response
    """
    try:
        converter = get_converter_service()
        if not converter.initialized:
            await converter.initialize()

        pdf_bytes = await converter.html_to_pdf(
            html=request.html,
            wrap_in_template=request.wrap_in_template,
            format=request.options.format,
            landscape=request.options.landscape,
            margin_top=request.options.margin_top,
            margin_bottom=request.options.margin_bottom,
            margin_left=request.options.margin_left,
            margin_right=request.options.margin_right,
            print_background=request.options.print_background,
            extra_css=request.extra_css,
        )

        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": "attachment; filename=document.pdf"},
        )

    except Exception as e:
        logger.error(f"Error converting HTML to PDF: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to convert HTML to PDF: {str(e)}",
        )


@app.post("/api/v1/convert/html-to-image")
async def convert_html_to_image(request: HtmlToImageRequest):
    """
    Convert HTML content to image (PNG or JPEG).

    Args:
        request: HTML content and image options

    Returns:
        Image file as binary response
    """
    try:
        converter = get_converter_service()
        if not converter.initialized:
            await converter.initialize()

        image_bytes = await converter.html_to_image(
            html=request.html,
            wrap_in_template=request.wrap_in_template,
            image_type=request.options.image_type,
            quality=request.options.quality,
            full_page=request.options.full_page,
            width=request.options.width,
            extra_css=request.extra_css,
        )

        media_type = "image/png" if request.options.image_type == "png" else "image/jpeg"
        ext = request.options.image_type

        return Response(
            content=image_bytes,
            media_type=media_type,
            headers={"Content-Disposition": f"attachment; filename=document.{ext}"},
        )

    except Exception as e:
        logger.error(f"Error converting HTML to image: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to convert HTML to image: {str(e)}",
        )


@app.post("/api/v1/convert/url-to-pdf")
async def convert_url_to_pdf(request: UrlToPdfRequest):
    """
    Capture a URL as PDF.

    Args:
        request: URL and PDF options

    Returns:
        PDF file as binary response
    """
    try:
        converter = get_converter_service()
        if not converter.initialized:
            await converter.initialize()

        pdf_bytes = await converter.url_to_pdf(
            url=str(request.url),
            wait_until=request.wait_until,
            format=request.options.format,
            landscape=request.options.landscape,
            margin_top=request.options.margin_top,
            margin_bottom=request.options.margin_bottom,
            margin_left=request.options.margin_left,
            margin_right=request.options.margin_right,
            print_background=request.options.print_background,
        )

        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": "attachment; filename=document.pdf"},
        )

    except Exception as e:
        logger.error(f"Error converting URL to PDF: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to convert URL to PDF: {str(e)}",
        )


@app.post("/api/v1/convert/url-to-image")
async def convert_url_to_image(request: UrlToImageRequest):
    """
    Capture a URL as image (screenshot).

    Args:
        request: URL and image options

    Returns:
        Image file as binary response
    """
    try:
        converter = get_converter_service()
        if not converter.initialized:
            await converter.initialize()

        image_bytes = await converter.url_to_image(
            url=str(request.url),
            wait_until=request.wait_until,
            image_type=request.options.image_type,
            quality=request.options.quality,
            full_page=request.options.full_page,
            width=request.options.width,
            height=request.height,
        )

        media_type = "image/png" if request.options.image_type == "png" else "image/jpeg"
        ext = request.options.image_type

        return Response(
            content=image_bytes,
            media_type=media_type,
            headers={"Content-Disposition": f"attachment; filename=screenshot.{ext}"},
        )

    except Exception as e:
        logger.error(f"Error converting URL to image: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to convert URL to image: {str(e)}",
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


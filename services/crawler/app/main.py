"""
Tale Crawler Service

Independent web crawling service using Crawl4AI.
Provides REST API for website crawling and URL discovery.
"""

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, status
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
    # Template models
    AnalyzePptxResponse,
    GeneratePptxResponse,
    GenerateDocxRequest,
    GenerateDocxResponse,
    # File parsing models
    ParseFileResponse,
)
from app.crawler_service import get_crawler_service
from app.converter_service import get_converter_service
from app.template_service import get_template_service
from app.file_parser_service import FileParserService

# Global file parser service instance
_file_parser_service: FileParserService | None = None


def get_file_parser_service() -> FileParserService:
    """Get or create the file parser service instance."""
    global _file_parser_service
    if _file_parser_service is None:
        _file_parser_service = FileParserService()
    return _file_parser_service


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


# ==================== PPTX/DOCX Template Endpoints ====================


@app.post("/api/v1/document/generate-docx", response_model=GenerateDocxResponse)
async def generate_docx_document(request: GenerateDocxRequest):
    """
    Generate a DOCX document from structured content.

    This endpoint creates a Word document from scratch with:
    - Title and optional subtitle
    - Sections: headings, paragraphs, bullet lists, numbered lists, tables

    No template is required - the document is generated with clean styling.

    Args:
        request: Document content structure

    Returns:
        Generated DOCX as base64 string
    """
    try:
        import base64

        template_service = get_template_service()

        # Convert Pydantic models to dicts
        content_dict = {
            "title": request.content.title,
            "subtitle": request.content.subtitle,
            "sections": [
                {
                    "type": section.type,
                    "text": section.text,
                    "level": section.level,
                    "items": section.items,
                    "headers": section.headers,
                    "rows": section.rows,
                }
                for section in request.content.sections
            ],
        }

        docx_bytes = await template_service.generate_docx(
            content=content_dict,
        )

        file_base64 = base64.b64encode(docx_bytes).decode("utf-8")

        return GenerateDocxResponse(
            success=True,
            file_base64=file_base64,
            file_size=len(docx_bytes),
        )

    except Exception as e:
        logger.error(f"Error generating DOCX: {e}")
        return GenerateDocxResponse(
            success=False,
            error=f"Failed to generate DOCX: {str(e)}",
        )


# ==================== Multipart Form Upload Endpoints ====================


@app.post("/api/v1/template/analyze-pptx-upload", response_model=AnalyzePptxResponse)
async def analyze_pptx_template_upload(
    template_file: UploadFile = File(..., description="PPTX template file to analyze"),
):
    """
    Analyze a PPTX template via file upload (multipart form).

    This is a memory-efficient alternative to the JSON endpoint that avoids
    base64 encoding overhead. Upload the PPTX file directly.

    Args:
        template_file: The PPTX template file

    Returns:
        Template structure information
    """
    try:
        template_bytes = await template_file.read()

        if not template_bytes:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Empty file uploaded",
            )

        template_service = get_template_service()
        result = await template_service.analyze_pptx_template(
            template_bytes=template_bytes,
        )

        return AnalyzePptxResponse(**result)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error analyzing PPTX template (upload): {e}")
        return AnalyzePptxResponse(
            success=False,
            error=f"Failed to analyze PPTX template: {str(e)}",
        )


@app.post("/api/v1/template/generate-pptx", response_model=GeneratePptxResponse)
async def generate_pptx_from_json(
    slides_content: str = Form(..., description="JSON array of slide content"),
    branding: str = Form(None, description="Optional JSON branding object"),
    template_file: UploadFile = File(None, description="Optional template PPTX file to use as base"),
):
    """
    Generate a PPTX from JSON content with optional template and branding.

    When template_file is provided, the template is used as a base,
    preserving all styling, backgrounds, and decorative elements. New slides
    are created using the template's layouts.

    When no template is provided, creates a new presentation and optionally
    applies branding (fonts, colors) if specified.

    Each slide in the array can have:
    - title: Slide title
    - subtitle: Slide subtitle
    - textContent: List of text paragraphs
    - bulletPoints: List of bullet point items
    - tables: List of tables with headers and rows
    - layoutName: Optional layout name hint (e.g., "Title Slide", "Blank")

    Branding (used when no template provided) can include:
    - titleFontName, bodyFontName: Font names
    - titleFontSize, bodyFontSize: Font sizes in points
    - primaryColor, secondaryColor, accentColor: Hex colors
    - slideWidth, slideHeight: Slide dimensions in inches

    Args:
        slides_content: JSON string of slide content array
        branding: Optional JSON string of branding settings
        template_file: Optional template PPTX file upload

    Returns:
        Generated PPTX as base64 string
    """
    try:
        import base64
        import json

        # Parse JSON string
        try:
            slides_content_list = json.loads(slides_content)
        except json.JSONDecodeError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid slides_content JSON: {str(e)}",
            )

        # Parse optional branding
        branding_dict = None
        if branding:
            try:
                branding_dict = json.loads(branding)
            except json.JSONDecodeError as e:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid branding JSON: {str(e)}",
                )

        # Read optional template file
        template_bytes = None
        if template_file:
            try:
                template_bytes = await template_file.read()
            except Exception as e:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Failed to read template file: {str(e)}",
                )

        template_service = get_template_service()

        pptx_bytes = await template_service.generate_pptx_from_content(
            slides_content=slides_content_list,
            branding=branding_dict,
            template_bytes=template_bytes,
        )

        file_base64 = base64.b64encode(pptx_bytes).decode("utf-8")

        return GeneratePptxResponse(
            success=True,
            file_base64=file_base64,
            file_size=len(pptx_bytes),
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating PPTX: {e}")
        return GeneratePptxResponse(
            success=False,
            error=f"Failed to generate PPTX: {str(e)}",
        )


# ==================== DOCX Template Endpoints (Multipart Form) ====================


@app.post("/api/v1/template/generate-docx", response_model=GenerateDocxResponse)
async def generate_docx_from_template(
    content: str = Form(..., description="JSON object with document content"),
    template_file: UploadFile = File(None, description="Optional template DOCX file to use as base"),
):
    """
    Generate a DOCX from JSON content with optional template.

    When template_file is provided, the template is used as a base,
    preserving all styling, headers/footers, and document properties.
    Content is then added based on the provided structure.

    When no template is provided, creates a new document from scratch.

    Args:
        content: JSON object with document content structure:
            {
                "title": "Document Title",
                "subtitle": "Optional subtitle",
                "sections": [
                    {"type": "heading", "level": 1, "text": "Section Title"},
                    {"type": "paragraph", "text": "Paragraph text..."},
                    {"type": "bullets", "items": ["Item 1", "Item 2"]},
                    {"type": "table", "headers": [...], "rows": [[...], [...]]},
                ]
            }
        template_file: Optional DOCX template file

    Returns:
        Generated DOCX as base64 string
    """
    try:
        import base64
        import json

        # Parse content JSON
        try:
            content_dict = json.loads(content)
            logger.info(f"[generate-docx] Received content: title={content_dict.get('title')}, subtitle={content_dict.get('subtitle')}, sections_count={len(content_dict.get('sections', []))}")
            # Log each section for debugging
            for i, section in enumerate(content_dict.get("sections", [])):
                section_type = section.get("type", "unknown")
                section_text = section.get("text", "")[:100] if section.get("text") else ""
                section_items = section.get("items", [])
                logger.info(f"[generate-docx] Section {i}: type={section_type}, text_preview={section_text[:50]}..., items_count={len(section_items)}")
        except json.JSONDecodeError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid content JSON: {str(e)}",
            )

        # Read optional template file
        template_bytes = None
        if template_file:
            try:
                template_bytes = await template_file.read()
            except Exception as e:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Failed to read template file: {str(e)}",
                )

        template_service = get_template_service()

        if template_bytes:
            # Generate from template
            docx_bytes = await template_service.generate_docx_from_template(
                content=content_dict,
                template_bytes=template_bytes,
            )
        else:
            # Generate from scratch
            docx_bytes = await template_service.generate_docx(
                content=content_dict,
            )

        file_base64 = base64.b64encode(docx_bytes).decode("utf-8")

        return GenerateDocxResponse(
            success=True,
            file_base64=file_base64,
            file_size=len(docx_bytes),
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating DOCX: {e}")
        return GenerateDocxResponse(
            success=False,
            error=f"Failed to generate DOCX: {str(e)}",
        )


# ==================== File Parsing Endpoints ====================


@app.post("/api/v1/parse/file", response_model=ParseFileResponse)
async def parse_file_upload(
    file: UploadFile = File(..., description="File to parse (PDF, DOCX, or PPTX)"),
):
    """
    Parse a document file and extract its text content.

    Supports PDF, DOCX, and PPTX files. Returns the extracted text content
    along with metadata like page count, paragraph count, or slide count.

    Args:
        file: The document file to parse

    Returns:
        Parsed content including full text and metadata
    """
    try:
        file_bytes = await file.read()

        if not file_bytes:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Empty file uploaded",
            )

        filename = file.filename or "unknown"
        content_type = file.content_type or ""

        parser = get_file_parser_service()
        result = parser.parse_file(file_bytes, filename, content_type)

        return ParseFileResponse(**result)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error parsing file: {e}")
        return ParseFileResponse(
            success=False,
            filename=file.filename or "unknown",
            error=f"Failed to parse file: {str(e)}",
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


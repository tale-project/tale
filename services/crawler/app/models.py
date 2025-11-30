"""
Data models for the Tale Crawler service.
"""

from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field, HttpUrl


class CrawlRequest(BaseModel):
    """Request to crawl a website."""

    url: HttpUrl = Field(..., description="The website URL to crawl")
    max_pages: int = Field(100, description="Maximum number of pages to crawl", ge=1, le=1000)
    pattern: Optional[str] = Field(None, description="Optional URL pattern filter (e.g., '*/docs/*')")
    query: Optional[str] = Field(None, description="Optional search query for filtering")
    word_count_threshold: int = Field(100, description="Minimum word count for content", ge=0)
    timeout: Optional[float] = Field(1800.0, description="Timeout in seconds for URL discovery (default: 1800 seconds / 30 minutes)", ge=1)


class PageContent(BaseModel):
    """Content from a crawled page."""

    url: str = Field(..., description="The page URL")
    title: Optional[str] = Field(None, description="Page title")
    content: str = Field(..., description="Extracted text content")
    word_count: int = Field(..., description="Number of words in content")
    metadata: Optional[Dict[str, Any]] = Field(None, description="Additional metadata")
    structured_data: Optional[Dict[str, Any]] = Field(None, description="Structured data (price, images, etc.)")


class CrawlResponse(BaseModel):
    """Response from a crawl operation."""

    success: bool = Field(..., description="Whether the crawl was successful")
    domain: Optional[str] = Field(None, description="The domain that was crawled")
    pages_discovered: int = Field(..., description="Number of pages discovered")
    pages_crawled: int = Field(..., description="Number of pages successfully crawled")
    pages: List[PageContent] = Field(default_factory=list, description="Crawled page contents")
    error: Optional[str] = Field(None, description="Error message if crawl failed")


class DiscoverRequest(BaseModel):
    """Request to discover URLs on a website."""

    domain: str = Field(..., description="The domain to discover URLs from (e.g., 'docs.example.com')")
    max_urls: int = Field(100, description="Maximum number of URLs to discover", ge=1, le=1000)
    pattern: Optional[str] = Field(None, description="Optional URL pattern filter")
    query: Optional[str] = Field(None, description="Optional search query for BM25 scoring")
    timeout: Optional[float] = Field(1800.0, description="Timeout in seconds for URL discovery (default: 1800 seconds / 30 minutes)", ge=1)


class DiscoveredUrl(BaseModel):
    """A discovered URL with metadata."""

    url: str = Field(..., description="The discovered URL")
    status: str = Field(..., description="Status of the URL (e.g., 'valid')")
    metadata: Optional[Dict[str, Any]] = Field(None, description="Additional metadata")


class DiscoverResponse(BaseModel):
    """Response from a URL discovery operation."""

    success: bool = Field(..., description="Whether the discovery was successful")
    domain: str = Field(..., description="The domain that was searched")
    urls_discovered: int = Field(..., description="Number of URLs discovered")
    urls: List[DiscoveredUrl] = Field(default_factory=list, description="Discovered URLs")
    error: Optional[str] = Field(None, description="Error message if discovery failed")


class FetchUrlsRequest(BaseModel):
    """Request to fetch content from specific URLs."""

    urls: List[str] = Field(..., description="List of URLs to fetch content from", min_length=1, max_length=100)
    word_count_threshold: int = Field(100, description="Minimum word count for content", ge=0)


class FetchUrlsResponse(BaseModel):
    """Response from a fetch URLs operation."""

    success: bool = Field(..., description="Whether the fetch was successful")
    urls_requested: int = Field(..., description="Number of URLs requested")
    urls_fetched: int = Field(..., description="Number of URLs successfully fetched")
    pages: List[PageContent] = Field(default_factory=list, description="Fetched page contents")
    error: Optional[str] = Field(None, description="Error message if fetch failed")


class HealthResponse(BaseModel):
    """Health check response."""

    status: str = Field(..., description="Service status")
    version: str = Field(..., description="Service version")
    crawler_initialized: bool = Field(..., description="Whether the crawler is initialized")
    converter_initialized: bool = Field(False, description="Whether the converter is initialized")


# ==================== Document Conversion Models ====================


class PdfOptions(BaseModel):
    """Options for PDF generation."""

    format: str = Field("A4", description="Paper format (A4, Letter, Legal, etc.)")
    landscape: bool = Field(False, description="Landscape orientation")
    margin_top: str = Field("20mm", description="Top margin")
    margin_bottom: str = Field("20mm", description="Bottom margin")
    margin_left: str = Field("20mm", description="Left margin")
    margin_right: str = Field("20mm", description="Right margin")
    print_background: bool = Field(True, description="Print background graphics")


class ImageOptions(BaseModel):
    """Options for image generation."""

    image_type: str = Field("png", description="Image type (png or jpeg)")
    quality: int = Field(90, description="JPEG quality (1-100)", ge=1, le=100)
    full_page: bool = Field(True, description="Capture full page or viewport only")
    width: int = Field(800, description="Viewport width", ge=100, le=4096)


class MarkdownToPdfRequest(BaseModel):
    """Request to convert Markdown to PDF."""

    content: str = Field(..., description="Markdown content to convert")
    options: PdfOptions = Field(default_factory=PdfOptions, description="PDF options")
    extra_css: Optional[str] = Field(None, description="Additional CSS styles")


class MarkdownToImageRequest(BaseModel):
    """Request to convert Markdown to image."""

    content: str = Field(..., description="Markdown content to convert")
    options: ImageOptions = Field(default_factory=ImageOptions, description="Image options")
    extra_css: Optional[str] = Field(None, description="Additional CSS styles")


class HtmlToPdfRequest(BaseModel):
    """Request to convert HTML to PDF."""

    html: str = Field(..., description="HTML content to convert")
    wrap_in_template: bool = Field(True, description="Wrap in default HTML template")
    options: PdfOptions = Field(default_factory=PdfOptions, description="PDF options")
    extra_css: Optional[str] = Field(None, description="Additional CSS styles")


class HtmlToImageRequest(BaseModel):
    """Request to convert HTML to image."""

    html: str = Field(..., description="HTML content to convert")
    wrap_in_template: bool = Field(True, description="Wrap in default HTML template")
    options: ImageOptions = Field(default_factory=ImageOptions, description="Image options")
    extra_css: Optional[str] = Field(None, description="Additional CSS styles")


class UrlToPdfRequest(BaseModel):
    """Request to convert URL to PDF."""

    url: HttpUrl = Field(..., description="URL to capture as PDF")
    options: PdfOptions = Field(default_factory=PdfOptions, description="PDF options")
    wait_until: str = Field("networkidle", description="Wait condition (load, domcontentloaded, networkidle)")


class UrlToImageRequest(BaseModel):
    """Request to convert URL to image (screenshot)."""

    url: HttpUrl = Field(..., description="URL to capture as image")
    options: ImageOptions = Field(default_factory=lambda: ImageOptions(width=1280), description="Image options")
    wait_until: str = Field("networkidle", description="Wait condition (load, domcontentloaded, networkidle)")
    height: int = Field(800, description="Viewport height", ge=100, le=4096)


"""
Data models for the Tale Crawler service.
"""

from typing import Any, Literal

from pydantic import BaseModel, Field, HttpUrl

# Valid Playwright wait_until values
WaitUntilType = Literal["load", "domcontentloaded", "networkidle", "commit"]


class PageContent(BaseModel):
    """Content from a crawled page."""

    url: str = Field(..., description="The page URL")
    title: str | None = Field(None, description="Page title")
    content: str = Field(..., description="Extracted text content")
    word_count: int = Field(..., description="Number of words in content")
    metadata: dict[str, Any] | None = Field(None, description="Additional metadata")
    structured_data: dict[str, Any] | None = Field(None, description="Structured data (price, images, etc.)")


class DiscoverRequest(BaseModel):
    """Request to discover URLs on a website."""

    domain: str = Field(..., description="The domain to discover URLs from (e.g., 'docs.example.com')")
    max_urls: int = Field(100, description="Maximum number of URLs to discover", ge=1, le=1000)
    pattern: str | None = Field(None, description="Optional URL pattern filter")
    query: str | None = Field(None, description="Optional search query for BM25 scoring")
    timeout: float | None = Field(
        1800.0,
        description="Timeout in seconds for URL discovery (default: 30 minutes)",
        ge=1,
    )


class DiscoveredUrl(BaseModel):
    """A discovered URL with metadata."""

    url: str = Field(..., description="The discovered URL")
    status: str = Field(..., description="Status of the URL (e.g., 'valid')")
    metadata: dict[str, Any] | None = Field(None, description="Additional metadata")


class DiscoverResponse(BaseModel):
    """Response from a URL discovery operation."""

    success: bool = Field(..., description="Whether the discovery was successful")
    domain: str = Field(..., description="The domain that was searched")
    urls_discovered: int = Field(..., description="Number of URLs discovered")
    urls: list[DiscoveredUrl] = Field(default_factory=list, description="Discovered URLs")
    error: str | None = Field(None, description="Error message if discovery failed")


class FetchUrlsRequest(BaseModel):
    """Request to fetch content from specific URLs."""

    urls: list[str] = Field(..., description="List of URLs to fetch content from", min_length=1, max_length=100)
    word_count_threshold: int = Field(100, description="Minimum word count for content", ge=0)


class FetchUrlsResponse(BaseModel):
    """Response from a fetch URLs operation."""

    success: bool = Field(..., description="Whether the fetch was successful")
    urls_requested: int = Field(..., description="Number of URLs requested")
    urls_fetched: int = Field(..., description="Number of URLs successfully fetched")
    pages: list[PageContent] = Field(default_factory=list, description="Fetched page contents")
    error: str | None = Field(None, description="Error message if fetch failed")


class HealthResponse(BaseModel):
    """Health check response."""

    status: str = Field(..., description="Service status")
    version: str = Field(..., description="Service version")
    crawler_initialized: bool = Field(..., description="Whether the crawler is initialized")
    pdf_service_initialized: bool = Field(False, description="Whether the PDF service is initialized")
    image_service_initialized: bool = Field(False, description="Whether the image service is initialized")


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
    quality: int = Field(100, description="JPEG quality (1-100)", ge=1, le=100)
    full_page: bool = Field(True, description="Capture full page or viewport only")
    width: int = Field(1920, description="Viewport width (default: 1920 for desktop)", ge=100, le=4096)
    scale: float = Field(2.0, description="Device scale factor for high-quality images (2.0 = Retina)", ge=1.0, le=4.0)


class MarkdownToPdfRequest(BaseModel):
    """Request to convert Markdown to PDF."""

    content: str = Field(..., description="Markdown content to convert")
    options: PdfOptions = Field(default_factory=PdfOptions, description="PDF options")
    extra_css: str | None = Field(None, description="Additional CSS styles")


class MarkdownToImageRequest(BaseModel):
    """Request to convert Markdown to image."""

    content: str = Field(..., description="Markdown content to convert")
    options: ImageOptions = Field(default_factory=ImageOptions, description="Image options")
    extra_css: str | None = Field(None, description="Additional CSS styles")


class HtmlToPdfRequest(BaseModel):
    """Request to convert HTML to PDF."""

    html: str = Field(..., description="HTML content to convert")
    wrap_in_template: bool = Field(True, description="Wrap in default HTML template")
    options: PdfOptions = Field(default_factory=PdfOptions, description="PDF options")
    extra_css: str | None = Field(None, description="Additional CSS styles")


class HtmlToImageRequest(BaseModel):
    """Request to convert HTML to image."""

    html: str = Field(..., description="HTML content to convert")
    wrap_in_template: bool = Field(True, description="Wrap in default HTML template")
    options: ImageOptions = Field(default_factory=ImageOptions, description="Image options")
    extra_css: str | None = Field(None, description="Additional CSS styles")


class UrlToPdfRequest(BaseModel):
    """Request to convert URL to PDF."""

    url: HttpUrl = Field(..., description="URL to capture as PDF")
    options: PdfOptions = Field(default_factory=PdfOptions, description="PDF options")
    wait_until: WaitUntilType = Field(
        "load",
        description="Wait condition (load, domcontentloaded, networkidle, commit)",
    )
    timeout: int = Field(
        60000, description="Navigation timeout in ms (default: 60s)", ge=5000, le=120000
    )


class UrlToImageRequest(BaseModel):
    """Request to convert URL to image (screenshot)."""

    url: HttpUrl = Field(..., description="URL to capture as image")
    options: ImageOptions = Field(default_factory=ImageOptions, description="Image options")
    wait_until: WaitUntilType = Field(
        "load",
        description="Wait condition (load, domcontentloaded, networkidle, commit)",
    )
    height: int = Field(1080, description="Viewport height", ge=100, le=4096)
    timeout: int = Field(60000, description="Navigation timeout in milliseconds (default: 60s)", ge=5000, le=120000)


# ==================== PPTX Models ====================


class TableData(BaseModel):
    """Table data for PPTX generation."""

    headers: list[str] = Field(default_factory=list, description="Column headers")
    rows: list[list[str]] = Field(default_factory=list, description="Table data rows")


class SlideContent(BaseModel):
    """Slide content - backend automatically selects best layout based on fields."""

    title: str | None = Field(None, description="Slide title")
    subtitle: str | None = Field(None, description="Slide subtitle (for title slides)")
    textContent: list[str] | None = Field(None, description="Text paragraphs")
    bulletPoints: list[str] | None = Field(None, description="Bullet point items")
    tables: list[TableData] | None = Field(None, description="Tables to add to the slide")


# ==================== PPTX Generation Models ====================


class GeneratePptxResponse(BaseModel):
    """Response from PPTX generation."""

    success: bool = Field(..., description="Whether generation was successful")
    file_base64: str | None = Field(None, description="Generated PPTX as base64")
    file_size: int | None = Field(None, description="File size in bytes")
    error: str | None = Field(None, description="Error message if generation failed")


# ==================== DOCX Generation Models ====================


class DocxSection(BaseModel):
    """A section of content in a DOCX document."""

    type: str = Field(..., description="Section type: heading, paragraph, bullets, numbered, table, quote, code")
    text: str | None = Field(None, description="Text content (for heading, paragraph, quote, code)")
    level: int | None = Field(None, description="Heading level (1-9)")
    items: list[str] | None = Field(None, description="List items (for bullets, numbered)")
    headers: list[str] | None = Field(None, description="Table headers")
    rows: list[list[Any]] | None = Field(None, description="Table rows")


class DocxContent(BaseModel):
    """Content structure for DOCX generation."""

    title: str = Field(..., description="Document title")
    subtitle: str | None = Field(None, description="Document subtitle")
    sections: list[DocxSection] = Field(default_factory=list, description="Document sections")


class GenerateDocxRequest(BaseModel):
    """Request to generate a DOCX document."""

    content: DocxContent = Field(..., description="Document content structure")


class GenerateDocxResponse(BaseModel):
    """Response from DOCX generation."""

    success: bool = Field(..., description="Whether generation was successful")
    file_base64: str | None = Field(None, description="Generated DOCX as base64")
    file_size: int | None = Field(None, description="File size in bytes")
    error: str | None = Field(None, description="Error message if generation failed")


# ==================== File Parsing Models ====================


class ParseFileResponse(BaseModel):
    """Response from file parsing."""

    success: bool = Field(..., description="Whether parsing was successful")
    filename: str = Field(..., description="Original filename")
    file_type: str | None = Field(None, description="Detected file MIME type")
    full_text: str | None = Field(None, description="Full extracted text content")
    page_count: int | None = Field(None, description="Number of pages (PDF)")
    paragraph_count: int | None = Field(None, description="Number of paragraphs (DOCX)")
    slide_count: int | None = Field(None, description="Number of slides (PPTX)")
    metadata: dict[str, Any] | None = Field(None, description="Document metadata")
    error: str | None = Field(None, description="Error message if parsing failed")

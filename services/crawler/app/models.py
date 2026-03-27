"""
Data models for the Tale Crawler service.
"""

from typing import Any, Literal
from urllib.parse import urlparse

from pydantic import BaseModel, Field, HttpUrl, field_validator

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


class RegisterWebsiteRequest(BaseModel):
    """Request to register a website for tracking."""

    domain: str = Field(..., description="The domain to register (e.g., 'docs.example.com')")
    scan_interval: int = Field(21600, description="Scan interval in seconds (default: 6h)", ge=60)

    @field_validator("domain")
    @classmethod
    def normalize_domain(cls, v: str) -> str:
        """Strip protocol/path — store bare hostname only."""
        if "://" in v:
            return urlparse(v).hostname or v
        return v


class WebsiteInfoResponse(BaseModel):
    """Full website information."""

    domain: str
    title: str | None = None
    description: str | None = None
    page_count: int = 0
    crawled_count: int = 0
    status: str = "idle"
    scan_interval: int = 21600
    last_scanned_at: str | None = None
    error: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class WebsiteUrl(BaseModel):
    """A tracked URL with content hash."""

    url: str = Field(..., description="The URL")
    content_hash: str | None = Field(None, description="SHA-256 content hash")
    status: str = Field("active", description="URL status (discovered, active, deleted)")
    last_crawled_at: float | None = Field(None, description="Last crawl timestamp")


class WebsiteUrlsResponse(BaseModel):
    """Paginated response of website URLs."""

    domain: str = Field(..., description="The website domain")
    urls: list[WebsiteUrl] = Field(default_factory=list, description="URL entries")
    total: int = Field(0, description="Total URL count")
    offset: int = Field(0, description="Current offset")
    has_more: bool = Field(False, description="Whether more pages are available")


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
    timeout: int = Field(60000, description="Navigation timeout in ms (default: 60s)", ge=5000, le=120000)


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


# ==================== DOCX from Markdown/HTML Models ====================


class MarkdownToDocxRequest(BaseModel):
    """Request to convert Markdown to DOCX."""

    content: str = Field(..., description="Markdown content to convert")


class HtmlToDocxRequest(BaseModel):
    """Request to convert HTML to DOCX."""

    html: str = Field(..., description="HTML content to convert")


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


# ==================== DOCX Round-Trip Models ====================


class LightweightParagraph(BaseModel):
    """A paragraph entry in the lightweight extraction output."""

    key: str = Field(..., description="Stable paragraph key (e.g., 'p_0', 'tbl_0_r0_c0_p0')")
    text: str = Field(..., description="Full text content of the paragraph")
    editable: bool = Field(..., description="Whether this paragraph can be safely modified")
    style: str | None = Field(None, description="Paragraph style name (e.g., 'Heading 1', 'Normal')")


class ExtractStructuredMetadata(BaseModel):
    """Metadata from structured DOCX extraction."""

    paragraph_count: int = Field(..., description="Total number of paragraphs")
    table_count: int = Field(..., description="Total number of tables")
    group_count: int = Field(0, description="Number of semantic paragraph groups")


class ExtractStructuredResponse(BaseModel):
    """Response from DOCX structured extraction."""

    source_hash: str = Field(..., description="SHA-256 hash of the source file")
    metadata: ExtractStructuredMetadata = Field(..., description="Document metadata")
    lightweight: list[LightweightParagraph] = Field(..., description="Paragraph key-text pairs")
    groups: list[list[LightweightParagraph]] = Field(
        default_factory=list, description="Semantic groups of editable paragraphs"
    )


class ApplyStructuredReport(BaseModel):
    """Report from applying structured modifications."""

    total_modifications_requested: int = Field(0, description="Total modifications requested")
    applied: int = Field(0, description="Number of modifications successfully applied")
    success: bool = Field(True, description="Whether the operation was successful overall")
    skipped_not_editable: list[str] = Field(default_factory=list, description="Keys skipped (not editable)")
    skipped_unknown_key: list[str] = Field(default_factory=list, description="Keys not found in document")
    skipped_no_change: list[str] = Field(default_factory=list, description="Keys where text was unchanged")
    skipped_non_text_content: list[str] = Field(default_factory=list, description="Keys with images/page breaks")
    format_simplified: list[str] = Field(
        default_factory=list, description="Keys where multi-run formatting was simplified"
    )
    errors: list[dict[str, Any]] = Field(default_factory=list, description="Errors encountered")


class ApplyStructuredResponse(BaseModel):
    """Response from applying structured modifications to DOCX."""

    success: bool = Field(..., description="Whether the operation was successful")
    file_base64: str | None = Field(None, description="Modified DOCX as base64")
    file_size: int | None = Field(None, description="File size in bytes")
    report: ApplyStructuredReport | None = Field(None, description="Detailed modification report")
    error: str | None = Field(None, description="Error message if operation failed")


# ==================== File Parsing Models ====================


class ParseFileResponse(BaseModel):
    """Response from file parsing."""

    success: bool = Field(..., description="Whether parsing was successful")
    filename: str = Field(..., description="Original filename")
    file_type: str | None = Field(None, description="Detected file MIME type")
    full_text: str | None = Field(None, description="Full extracted text content")
    page_count: int | None = Field(None, description="Number of pages (PDF)")
    paragraph_count: int | None = Field(None, description="Number of paragraphs (DOCX)")
    element_count: int | None = Field(None, description="Number of elements (DOCX with Vision)")
    slide_count: int | None = Field(None, description="Number of slides (PPTX)")
    metadata: dict[str, Any] | None = Field(None, description="Document metadata")
    vision_used: bool | None = Field(None, description="Whether Vision API was used")
    usage: dict[str, Any] | None = Field(
        None, description="LLM token usage (input_tokens, output_tokens, total_tokens, duration_ms, model)"
    )
    error: str | None = Field(None, description="Error message if parsing failed")


class FileMetadataResponse(BaseModel):
    """Response from lightweight metadata-only extraction."""

    success: bool = Field(..., description="Whether extraction was successful")
    filename: str = Field(..., description="Original filename")
    file_type: str | None = Field(None, description="Detected file MIME type")
    title: str | None = Field(None, description="Document title")
    author: str | None = Field(None, description="Document author")
    page_count: int | None = Field(None, description="Number of pages (PDF)")
    slide_count: int | None = Field(None, description="Number of slides (PPTX)")
    created_at: int | None = Field(None, description="Document creation date (Unix ms)")
    modified_at: int | None = Field(None, description="Document modification date (Unix ms)")
    error: str | None = Field(None, description="Error message if extraction failed")


# ==================== Web Fetch & Extract Models ====================


class WebFetchExtractRequest(BaseModel):
    """Request to fetch URL and extract content."""

    url: HttpUrl = Field(..., description="URL to fetch and extract content from")
    instruction: str | None = Field(None, description="Optional AI instruction for content extraction")
    timeout: int = Field(60000, description="Navigation timeout in ms (default: 60s)", ge=5000, le=120000)


class WebFetchExtractResponse(BaseModel):
    """Response from web fetch and extract operation."""

    success: bool = Field(..., description="Whether the operation was successful")
    url: str = Field(..., description="The fetched URL")
    title: str | None = Field(None, description="Page title")
    content: str = Field(..., description="Extracted text content")
    content_type: str = Field("text/html", description="Detected content type (e.g. text/html, application/pdf)")
    word_count: int = Field(..., description="Number of words in content")
    page_count: int = Field(..., description="Number of pages in PDF")
    vision_used: bool = Field(False, description="Whether Vision API was used for extraction")
    error: str | None = Field(None, description="Error message if operation failed")


# ==================== Search Models ====================


class SearchRequest(BaseModel):
    """Request for hybrid search."""

    query: str = Field(..., description="Search query")
    limit: int = Field(10, ge=1, le=100, description="Maximum results")


class SearchResultItem(BaseModel):
    """A single search result."""

    url: str
    title: str | None = None
    chunk_content: str
    chunk_index: int
    score: float


class SearchResponse(BaseModel):
    """Response from search endpoint."""

    query: str
    results: list[SearchResultItem] = Field(default_factory=list)
    total: int


# ==================== Pages List Models ====================


class PageListItem(BaseModel):
    """A page in the pages list."""

    url: str
    title: str | None = None
    word_count: int = 0
    status: str = "discovered"
    content_hash: str | None = None
    last_crawled_at: str | None = None
    discovered_at: str | None = None
    chunks_count: int = 0
    indexed: bool = False


class PageListResponse(BaseModel):
    """Paginated response of pages for a website."""

    domain: str
    pages: list[PageListItem] = Field(default_factory=list)
    total: int = 0
    offset: int = 0
    has_more: bool = False


class PageChunkItem(BaseModel):
    """A single chunk from a page."""

    chunk_index: int
    chunk_content: str


class PageChunksResponse(BaseModel):
    """Response containing all chunks for a specific page."""

    url: str
    domain: str
    chunks: list[PageChunkItem] = Field(default_factory=list)
    total: int = 0


# ==================== Indexing Models ====================


class IndexPageRequest(BaseModel):
    """Request to index a single page."""

    domain: str = Field(..., description="Website domain")
    url: str = Field(..., description="Page URL")
    title: str | None = Field(None, description="Page title")
    content: str = Field(..., description="Page content to index")


class IndexPageResponse(BaseModel):
    """Response from indexing a single page."""

    success: bool
    url: str
    chunks_indexed: int
    status: str
    error: str | None = None


class IndexWebsiteResponse(BaseModel):
    """Response from indexing all pages for a website."""

    success: bool
    domain: str
    pages_indexed: int
    pages_skipped: int
    pages_failed: int
    total_chunks: int

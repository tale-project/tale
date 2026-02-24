"""
Web Router - URL content extraction endpoint.

Extracts content from web pages (via Crawl4AI), document files (PDF, DOCX, PPTX),
and image files (PNG, JPG, GIF, WebP, BMP, TIFF, SVG).
"""

import socket
from ipaddress import ip_address
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException, status
from loguru import logger

from app.models import WebFetchExtractRequest, WebFetchExtractResponse
from app.services.crawler_service import get_crawler_service
from app.services.file_parser_service import get_file_parser_service
from app.services.web_image_extractor import extract_and_describe_images
from app.utils.content_type import detect_type_from_content_type, detect_type_from_url

router = APIRouter(prefix="/api/v1/web", tags=["Web"])

MAX_FILE_DOWNLOAD_BYTES = 100 * 1024 * 1024  # 100 MB
_HTTP_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; TaleCrawler/1.0)",
    "Accept": "*/*",
}


def validate_url_not_private(url_str: str) -> str:
    """
    Validate that a URL does not resolve to a private/internal IP address.

    Prevents SSRF attacks by blocking requests to loopback, link-local,
    and private RFC1918/IPv6 addresses.

    Args:
        url_str: The URL to validate

    Returns:
        The hostname if validation passes

    Raises:
        HTTPException: If the URL host cannot be resolved or resolves to a private IP
    """
    parsed_url = urlparse(url_str)
    hostname = parsed_url.hostname or ""

    if not hostname:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid URL: no hostname found",
        )

    try:
        resolved_ips = {ip_address(info[4][0]) for info in socket.getaddrinfo(hostname, None)}
    except socket.gaierror:
        logger.warning(f"SSRF protection: unable to resolve hostname '{hostname}'")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to resolve URL host",
        ) from None

    blocked_ips = [ip for ip in resolved_ips if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved]

    if blocked_ips:
        logger.warning(
            f"SSRF protection: blocked request to '{hostname}' (resolved to private/internal IPs: {blocked_ips})"
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="URL host is not allowed (resolves to private/internal address)",
        )

    return hostname


async def _probe_url(url_str: str, timeout: float) -> tuple[str, str | None, str]:
    """
    Probe a URL with a HEAD request to determine Content-Type.

    Returns:
        Tuple of (content_type_header, extension_or_None, category).
    """
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=timeout, headers=_HTTP_HEADERS) as client:
            response = await client.head(url_str)
            content_type = response.headers.get("content-type", "")
            ext, category = detect_type_from_content_type(content_type)
            return content_type, ext, category
    except httpx.HTTPError:
        logger.debug(f"HEAD request failed for {url_str}, will try URL extension detection")
        return "", None, "unknown"


async def _download_file(url_str: str, timeout: float) -> tuple[bytes, str]:
    """
    Download file bytes from a URL using streaming.

    Returns:
        Tuple of (file_bytes, content_type).

    Raises:
        HTTPException: If file exceeds max size or download fails.
    """
    async with (
        httpx.AsyncClient(follow_redirects=True, timeout=timeout, headers=_HTTP_HEADERS) as client,
        client.stream("GET", url_str) as response,
    ):
        response.raise_for_status()
        content_type = response.headers.get("content-type", "")
        content_length = response.headers.get("content-length")

        if content_length and int(content_length) > MAX_FILE_DOWNLOAD_BYTES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File too large ({int(content_length)} bytes). Maximum: {MAX_FILE_DOWNLOAD_BYTES} bytes.",
            )

        chunks = []
        total = 0
        async for chunk in response.aiter_bytes():
            total += len(chunk)
            if total > MAX_FILE_DOWNLOAD_BYTES:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"File too large (>{MAX_FILE_DOWNLOAD_BYTES} bytes). Download aborted.",
                )
            chunks.append(chunk)

        return b"".join(chunks), content_type


def _build_filename(hostname: str, ext: str) -> str:
    """Build a filename from hostname and extension."""
    return f"{hostname}{ext}"


async def _extract_from_file(
    url_str: str,
    hostname: str,
    file_ext: str,
    content_type: str,
    instruction: str | None,
    timeout: float,
) -> WebFetchExtractResponse:
    """Download a file URL and extract content using the appropriate parser."""
    logger.info(f"Downloading file ({file_ext}): {url_str}")
    file_bytes, actual_ct = await _download_file(url_str, timeout)
    logger.info(f"Downloaded {len(file_bytes)} bytes, parsing as {file_ext}")

    parser = get_file_parser_service()
    filename = _build_filename(hostname, file_ext)
    result = await parser.parse_file_with_vision(
        file_bytes,
        filename=filename,
        content_type=actual_ct or content_type or "",
        user_input=instruction,
        process_images=True,
        ocr_scanned_pages=True,
    )

    if not result.get("success"):
        return WebFetchExtractResponse(
            success=False,
            url=url_str,
            content="",
            content_type=actual_ct or content_type or "",
            word_count=0,
            page_count=0,
            error=result.get("error", "Failed to extract content from file"),
        )

    full_text = result.get("full_text", "")
    word_count = len(full_text.split()) if full_text else 0
    page_count = result.get("page_count") or result.get("slide_count") or 0

    logger.info(
        f"File content extracted: {word_count} words, {page_count} pages/slides, "
        f"vision_used={result.get('vision_used', False)}"
    )

    return WebFetchExtractResponse(
        success=True,
        url=url_str,
        content=full_text,
        content_type=actual_ct or content_type or "",
        word_count=word_count,
        page_count=page_count,
        vision_used=result.get("vision_used", False),
    )


async def _extract_from_image(
    url_str: str,
    content_type: str,
    instruction: str | None,
    timeout: float,
) -> WebFetchExtractResponse:
    """Download an image URL and extract content using Vision API (OCR + description)."""
    from app.services.vision.openai_client import process_pages_with_llm, vision_client

    logger.info(f"Downloading image: {url_str}")
    image_bytes, actual_ct = await _download_file(url_str, timeout)
    logger.info(f"Downloaded image ({len(image_bytes)} bytes), extracting with Vision API")

    detected_ct = actual_ct or content_type or ""

    ocr_text = await vision_client.ocr_image(image_bytes)
    description = await vision_client.describe_image(image_bytes)

    parts = []
    if description:
        parts.append(f"[Image: {description}]")
    if ocr_text:
        parts.append(ocr_text)

    full_text = "\n\n".join(parts) if parts else ""

    if instruction and full_text:
        processed = await process_pages_with_llm([full_text], instruction, max_concurrent=1)
        full_text = "\n\n".join(processed)

    word_count = len(full_text.split()) if full_text else 0

    logger.info(f"Image content extracted: {word_count} words, vision_used=True")

    return WebFetchExtractResponse(
        success=True,
        url=url_str,
        content=full_text,
        content_type=detected_ct,
        word_count=word_count,
        page_count=1,
        vision_used=True,
    )


async def _extract_from_webpage(
    url_str: str,
    hostname: str,
    instruction: str | None,
    timeout: float,
) -> WebFetchExtractResponse:
    """Extract content from a web page using Crawl4AI for text and Vision API for images.

    Pipeline:
    1. Crawl4AI extracts markdown text + discovers page images
    2. Significant images are downloaded and described via Vision API
    3. Text and image descriptions are combined
    4. Optionally processed with LLM using the provided instruction

    Args:
        url_str: URL to extract content from
        hostname: Validated hostname
        instruction: Optional AI instruction for content extraction
        timeout: Timeout in seconds

    Returns:
        Extracted content with metadata
    """
    from app.services.vision.openai_client import process_pages_with_llm

    crawler = get_crawler_service()
    if not crawler.initialized:
        await crawler.initialize()

    logger.info(f"Crawling web page: {url_str}")

    try:
        crawl_result = await crawler.crawl_single_url(url_str, timeout=timeout)
    except TimeoutError:
        return WebFetchExtractResponse(
            success=False,
            url=url_str,
            content="",
            content_type="text/html",
            word_count=0,
            page_count=0,
            error=f"Timed out crawling {url_str}",
        )
    except RuntimeError as e:
        return WebFetchExtractResponse(
            success=False,
            url=url_str,
            content="",
            content_type="text/html",
            word_count=0,
            page_count=0,
            error=str(e),
        )

    markdown_content = crawl_result["content"]
    title = crawl_result.get("title")
    media_images = crawl_result.get("media_images", [])

    image_descriptions, vision_used = await extract_and_describe_images(media_images, url_str)

    parts = [markdown_content]
    if image_descriptions:
        parts.extend(image_descriptions)

    full_text = "\n\n".join(filter(None, parts))

    if instruction and full_text:
        processed = await process_pages_with_llm([full_text], instruction, max_concurrent=3)
        full_text = "\n\n".join(processed)

    word_count = len(full_text.split()) if full_text else 0

    logger.info(
        f"Web page extracted: {word_count} words, {len(image_descriptions)} images described, vision_used={vision_used}"
    )

    return WebFetchExtractResponse(
        success=True,
        url=url_str,
        title=title,
        content=full_text,
        content_type="text/html",
        word_count=word_count,
        page_count=0,
        vision_used=vision_used,
    )


@router.post("/fetch-and-extract", response_model=WebFetchExtractResponse)
async def fetch_and_extract(request: WebFetchExtractRequest):
    """
    Fetch a URL and extract text content.

    Pipeline:
    1. Probe URL to detect content type (file link, image, or web page)
    2a. For documents (PDF, DOCX, PPTX): download and parse directly
    2b. For images (PNG, JPG, GIF, WebP, etc.): download and extract via Vision API
    2c. For web pages: extract text via Crawl4AI, describe images via Vision API
    3. Optionally process with AI using the provided instruction

    Args:
        request: URL and optional extraction instruction

    Returns:
        Extracted content with metadata
    """
    url_str = str(request.url)
    hostname = validate_url_not_private(url_str)
    timeout_seconds = request.timeout / 1000

    try:
        # Detect content type — first by URL extension, then by HEAD probe
        ext, category = detect_type_from_url(url_str)
        content_type = ""

        if category == "unknown":
            content_type, ext, category = await _probe_url(url_str, timeout=min(timeout_seconds, 10))

        if category == "document" and ext:
            return await _extract_from_file(url_str, hostname, ext, content_type, request.instruction, timeout_seconds)

        if category == "image":
            return await _extract_from_image(url_str, content_type, request.instruction, timeout_seconds)

        return await _extract_from_webpage(url_str, hostname, request.instruction, timeout_seconds)

    except HTTPException:
        raise
    except Exception:
        logger.exception(f"Error fetching and extracting URL: {url_str}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch and extract content from URL: {url_str}",
        ) from None

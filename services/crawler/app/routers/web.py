"""
Web Router - URL content extraction endpoint.

Combines URL-to-PDF conversion with Vision-based text extraction.
"""

from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, status
from loguru import logger

from app.models import WebFetchExtractRequest, WebFetchExtractResponse
from app.services.file_parser_service import get_file_parser_service
from app.services.pdf_service import get_pdf_service

router = APIRouter(prefix="/api/v1/web", tags=["Web"])


@router.post("/fetch-and-extract", response_model=WebFetchExtractResponse)
async def fetch_and_extract(request: WebFetchExtractRequest):
    """
    Fetch a URL, convert to PDF, and extract text content.

    Pipeline:
    1. Navigate to URL with Playwright and render as PDF
    2. Extract text using PyMuPDF + Vision API (handles images, OCR for scanned content)

    Args:
        request: URL and optional extraction instruction

    Returns:
        Extracted content with metadata
    """
    url_str = str(request.url)
    hostname = urlparse(url_str).netloc

    try:
        pdf_service = get_pdf_service()
        if not pdf_service.initialized:
            await pdf_service.initialize()

        logger.info(f"Fetching URL as PDF: {url_str}")
        pdf_bytes = await pdf_service.url_to_pdf(
            url=url_str,
            timeout=request.timeout,
        )

        logger.info(f"Extracting content from PDF ({len(pdf_bytes)} bytes)")
        parser = get_file_parser_service()
        result = await parser.parse_pdf_with_vision(
            pdf_bytes,
            filename=f"{hostname}.pdf",
            user_input=request.instruction,
            process_images=True,
            ocr_scanned_pages=True,
        )

        if not result.get("success"):
            return WebFetchExtractResponse(
                success=False,
                url=url_str,
                content="",
                word_count=0,
                page_count=0,
                error=result.get("error", "Failed to extract content from PDF"),
            )

        full_text = result.get("full_text", "")
        word_count = len(full_text.split()) if full_text else 0

        logger.info(
            f"Content extracted: {word_count} words, {result.get('page_count', 0)} pages, "
            f"vision_used={result.get('vision_used', False)}"
        )

        return WebFetchExtractResponse(
            success=True,
            url=url_str,
            content=full_text,
            word_count=word_count,
            page_count=result.get("page_count", 0),
            vision_used=result.get("vision_used", False),
        )

    except Exception:
        logger.exception(f"Error fetching and extracting URL: {url_str}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch and extract content from URL: {url_str}",
        ) from None

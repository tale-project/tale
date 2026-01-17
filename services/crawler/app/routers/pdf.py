"""
PDF Router - PDF conversion and parsing endpoints.
"""

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from fastapi.responses import Response
from loguru import logger

from app.models import (
    HtmlToPdfRequest,
    MarkdownToPdfRequest,
    ParseFileResponse,
    UrlToPdfRequest,
)
from app.services.file_parser_service import get_file_parser_service
from app.services.pdf_service import get_pdf_service

router = APIRouter(prefix="/api/v1/pdf", tags=["PDF"])


@router.post("/from-markdown")
async def convert_markdown_to_pdf(request: MarkdownToPdfRequest):
    """
    Convert Markdown content to PDF.

    Args:
        request: Markdown content and PDF options

    Returns:
        PDF file as binary response
    """
    try:
        pdf_service = get_pdf_service()
        if not pdf_service.initialized:
            await pdf_service.initialize()

        pdf_bytes = await pdf_service.markdown_to_pdf(
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

    except Exception:
        logger.exception("Error converting markdown to PDF")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to convert markdown to PDF",
        ) from None


@router.post("/from-html")
async def convert_html_to_pdf(request: HtmlToPdfRequest):
    """
    Convert HTML content to PDF.

    Args:
        request: HTML content and PDF options

    Returns:
        PDF file as binary response
    """
    try:
        pdf_service = get_pdf_service()
        if not pdf_service.initialized:
            await pdf_service.initialize()

        pdf_bytes = await pdf_service.html_to_pdf(
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

    except Exception:
        logger.exception("Error converting HTML to PDF")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to convert HTML to PDF",
        ) from None


@router.post("/from-url")
async def convert_url_to_pdf(request: UrlToPdfRequest):
    """
    Capture a URL as PDF.

    Args:
        request: URL and PDF options

    Returns:
        PDF file as binary response
    """
    try:
        pdf_service = get_pdf_service()
        if not pdf_service.initialized:
            await pdf_service.initialize()

        pdf_bytes = await pdf_service.url_to_pdf(
            url=str(request.url),
            wait_until=request.wait_until,
            timeout=request.timeout,
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

    except Exception:
        logger.exception("Error converting URL to PDF")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to convert URL to PDF",
        ) from None


@router.post("/parse", response_model=ParseFileResponse)
async def parse_pdf_file(
    file: UploadFile = File(..., description="PDF file to parse"),
):
    """
    Parse a PDF file and extract its text content.

    Returns the extracted text content along with metadata like page count.

    Args:
        file: The PDF file to parse

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

        filename = file.filename or "unknown.pdf"

        parser = get_file_parser_service()
        result = parser.parse_pdf(file_bytes, filename)

        return ParseFileResponse(**result)

    except HTTPException:
        raise
    except Exception:
        logger.exception("Error parsing PDF file")
        return ParseFileResponse(
            success=False,
            filename=file.filename or "unknown",
            error="Failed to parse PDF file",
        )

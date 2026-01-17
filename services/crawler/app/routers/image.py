"""
Image Router - Image conversion endpoints (HTML/Markdown/URL to PNG/JPEG).
"""

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import Response
from loguru import logger

from app.models import (
    HtmlToImageRequest,
    MarkdownToImageRequest,
    UrlToImageRequest,
)
from app.services.image_service import get_image_service

router = APIRouter(prefix="/api/v1/images", tags=["Images"])


@router.post("/from-markdown")
async def convert_markdown_to_image(request: MarkdownToImageRequest):
    """
    Convert Markdown content to image (PNG or JPEG).

    Args:
        request: Markdown content and image options

    Returns:
        Image file as binary response
    """
    try:
        image_service = get_image_service()
        if not image_service.initialized:
            await image_service.initialize()

        image_bytes = await image_service.markdown_to_image(
            markdown=request.content,
            image_type=request.options.image_type,
            quality=request.options.quality,
            full_page=request.options.full_page,
            width=request.options.width,
            extra_css=request.extra_css,
            scale=request.options.scale,
        )

        media_type = "image/png" if request.options.image_type == "png" else "image/jpeg"
        ext = request.options.image_type

        return Response(
            content=image_bytes,
            media_type=media_type,
            headers={"Content-Disposition": f"attachment; filename=document.{ext}"},
        )

    except Exception:
        logger.exception("Error converting markdown to image")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to convert markdown to image",
        ) from None


@router.post("/from-html")
async def convert_html_to_image(request: HtmlToImageRequest):
    """
    Convert HTML content to image (PNG or JPEG).

    Args:
        request: HTML content and image options

    Returns:
        Image file as binary response
    """
    try:
        image_service = get_image_service()
        if not image_service.initialized:
            await image_service.initialize()

        image_bytes = await image_service.html_to_image(
            html=request.html,
            wrap_in_template=request.wrap_in_template,
            image_type=request.options.image_type,
            quality=request.options.quality,
            full_page=request.options.full_page,
            width=request.options.width,
            extra_css=request.extra_css,
            scale=request.options.scale,
        )

        media_type = "image/png" if request.options.image_type == "png" else "image/jpeg"
        ext = request.options.image_type

        return Response(
            content=image_bytes,
            media_type=media_type,
            headers={"Content-Disposition": f"attachment; filename=document.{ext}"},
        )

    except Exception:
        logger.exception("Error converting HTML to image")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to convert HTML to image",
        ) from None


@router.post("/from-url")
async def convert_url_to_image(request: UrlToImageRequest):
    """
    Capture a URL as image (screenshot).

    Args:
        request: URL and image options

    Returns:
        Image file as binary response
    """
    try:
        image_service = get_image_service()
        if not image_service.initialized:
            await image_service.initialize()

        image_bytes = await image_service.url_to_image(
            url=str(request.url),
            wait_until=request.wait_until,
            image_type=request.options.image_type,
            quality=request.options.quality,
            full_page=request.options.full_page,
            width=request.options.width,
            height=request.height,
            scale=request.options.scale,
            timeout=request.timeout,
        )

        media_type = "image/png" if request.options.image_type == "png" else "image/jpeg"
        ext = request.options.image_type

        return Response(
            content=image_bytes,
            media_type=media_type,
            headers={"Content-Disposition": f"attachment; filename=screenshot.{ext}"},
        )

    except Exception:
        logger.exception("Error converting URL to image")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to convert URL to image",
        ) from None


"""
PPTX Router - PowerPoint template generation and parsing endpoints.
"""

import base64
import json

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from loguru import logger

from app.models import (
    AnalyzePptxResponse,
    GeneratePptxResponse,
    ParseFileResponse,
)
from app.services.template_service import get_template_service
from app.services.file_parser_service import get_file_parser_service

router = APIRouter(prefix="/api/v1/pptx", tags=["PPTX"])


@router.post("/analyze", response_model=AnalyzePptxResponse)
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
    except Exception:
        logger.exception("Error analyzing PPTX template (upload)")
        return AnalyzePptxResponse(
            success=False,
            error="Failed to analyze PPTX template",
        )


@router.post("", response_model=GeneratePptxResponse)
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
        # Parse JSON string
        try:
            slides_content_list = json.loads(slides_content)
        except json.JSONDecodeError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid slides_content JSON: {e!s}",
            ) from e

        # Parse optional branding
        branding_dict = None
        if branding:
            try:
                branding_dict = json.loads(branding)
            except json.JSONDecodeError as e:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid branding JSON: {e!s}",
                ) from e

        # Read optional template file
        template_bytes = None
        if template_file:
            try:
                template_bytes = await template_file.read()
            except OSError as e:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Failed to read template file: {e!s}",
                ) from e

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
    except Exception:
        logger.exception("Error generating PPTX")
        return GeneratePptxResponse(
            success=False,
            error="Failed to generate PPTX",
        )


@router.post("/parse", response_model=ParseFileResponse)
async def parse_pptx_file(
    file: UploadFile = File(..., description="PPTX file to parse"),
):
    """
    Parse a PPTX file and extract its text content.

    Returns the extracted text content along with metadata like slide count.

    Args:
        file: The PPTX file to parse

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

        filename = file.filename or "unknown.pptx"

        parser = get_file_parser_service()
        result = parser.parse_pptx(file_bytes, filename)

        return ParseFileResponse(**result)

    except HTTPException:
        raise
    except Exception:
        logger.exception("Error parsing PPTX file")
        return ParseFileResponse(
            success=False,
            filename=file.filename or "unknown",
            error="Failed to parse PPTX file",
        )

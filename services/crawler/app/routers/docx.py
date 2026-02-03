"""
DOCX Router - Word document generation and parsing endpoints.
"""

import base64
import json

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from loguru import logger

from app.models import (
    GenerateDocxRequest,
    GenerateDocxResponse,
    ParseFileResponse,
)
from app.services.file_parser_service import get_file_parser_service
from app.services.template_service import get_template_service

router = APIRouter(prefix="/api/v1/docx", tags=["DOCX"])


@router.post("", response_model=GenerateDocxResponse)
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
        template_service = get_template_service()

        content_dict = request.content.model_dump(exclude_none=True)

        docx_bytes = await template_service.generate_docx(
            content=content_dict,
        )

        file_base64 = base64.b64encode(docx_bytes).decode("utf-8")

        return GenerateDocxResponse(
            success=True,
            file_base64=file_base64,
            file_size=len(docx_bytes),
        )

    except Exception:
        logger.exception("Error generating DOCX")
        return GenerateDocxResponse(
            success=False,
            error="Failed to generate DOCX",
        )


@router.post("/from-template", response_model=GenerateDocxResponse)
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
        # Parse content JSON
        try:
            content_dict = json.loads(content)
        except json.JSONDecodeError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid content JSON: {e!s}",
            ) from e

        # Validate content_dict is a dict
        if not isinstance(content_dict, dict):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid content shape: expected object, got {type(content_dict).__name__}",
            )

        # Validate top-level fields
        if "title" in content_dict and content_dict["title"] is not None:
            if not isinstance(content_dict["title"], str):
                title_type = type(content_dict["title"]).__name__
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid content: 'title' must be a string, got {title_type}",
                )

        if "subtitle" in content_dict and content_dict["subtitle"] is not None:
            if not isinstance(content_dict["subtitle"], str):
                subtitle_type = type(content_dict["subtitle"]).__name__
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid content: 'subtitle' must be a string, got {subtitle_type}",
                )

        # Validate sections field
        if "sections" in content_dict:
            sections = content_dict["sections"]
            if not isinstance(sections, list):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid content: 'sections' must be an array, got {type(sections).__name__}",
                )

            valid_section_types = {
                "heading", "paragraph", "bullets", "numbered", "table", "quote", "code"
            }
            for idx, section in enumerate(sections):
                if not isinstance(section, dict):
                    section_type = type(section).__name__
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Invalid content: sections[{idx}] must be an object, got {section_type}",
                    )
                if "type" not in section:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Invalid content: sections[{idx}] missing required 'type' field",
                    )
                if not isinstance(section["type"], str):
                    sec_type = type(section["type"]).__name__
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Invalid content: sections[{idx}].type must be string, got {sec_type}",
                    )
                if section["type"] not in valid_section_types:
                    valid_types = ", ".join(sorted(valid_section_types))
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Invalid sections[{idx}].type '{section['type']}': must be {valid_types}",
                    )

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
    except Exception:
        logger.exception("Error generating DOCX from template")
        return GenerateDocxResponse(
            success=False,
            error="Failed to generate DOCX",
        )


@router.post("/parse", response_model=ParseFileResponse)
async def parse_docx_file(
    file: UploadFile = File(..., description="DOCX file to parse"),
    user_input: str | None = Form(None, description="User instruction for AI extraction per section"),
    process_images: bool = Form(True, description="Extract and describe embedded images"),
):
    """
    Parse a DOCX file and extract its text content using Vision API.

    Uses Vision API to:
    - Extract and describe embedded images
    - Optionally process with user instructions

    Args:
        file: The DOCX file to parse
        user_input: Optional user instruction for AI extraction per section
        process_images: Whether to extract and describe embedded images

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

        filename = file.filename or "unknown.docx"

        parser = get_file_parser_service()
        result = await parser.parse_docx_with_vision(
            file_bytes,
            filename,
            user_input=user_input,
            process_images=process_images,
        )

        return ParseFileResponse(**result)

    except HTTPException:
        raise
    except Exception:
        logger.exception("Error parsing DOCX file")
        return ParseFileResponse(
            success=False,
            filename=file.filename or "unknown",
            error="Failed to parse DOCX file",
        )

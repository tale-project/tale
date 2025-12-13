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
from app.services.template_service import get_template_service
from app.services.file_parser_service import FileParserService

router = APIRouter(prefix="/api/v1/docx", tags=["DOCX"])

# Global file parser service instance
_file_parser_service: FileParserService | None = None


def get_file_parser_service() -> FileParserService:
    """Get or create the file parser service instance."""
    global _file_parser_service
    if _file_parser_service is None:
        _file_parser_service = FileParserService()
    return _file_parser_service


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


@router.post("/parse", response_model=ParseFileResponse)
async def parse_docx_file(
    file: UploadFile = File(..., description="DOCX file to parse"),
):
    """
    Parse a DOCX file and extract its text content.

    Returns the extracted text content along with metadata like paragraph count.

    Args:
        file: The DOCX file to parse

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
        result = parser.parse_docx(file_bytes, filename)

        return ParseFileResponse(**result)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error parsing DOCX file: {e}")
        return ParseFileResponse(
            success=False,
            filename=file.filename or "unknown",
            error=f"Failed to parse DOCX file: {str(e)}",
        )

"""
DOCX Router - Word document generation and parsing endpoints.
"""

import base64
import json

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from fastapi.responses import Response
from loguru import logger

from app.models import (
    ApplyStructuredResponse,
    ExtractStructuredResponse,
    FileMetadataResponse,
    GenerateDocxRequest,
    GenerateDocxResponse,
    HtmlToDocxRequest,
    MarkdownToDocxRequest,
    ParseFileResponse,
)
from app.services.docx_roundtrip_service import _MAX_PARAGRAPHS, get_docx_roundtrip_service
from app.services.docx_service import get_docx_service
from app.services.file_parser_service import get_file_parser_service
from app.services.template_service import get_template_service

router = APIRouter(prefix="/api/v1/docx", tags=["DOCX"])

_FILE_TEMPLATE = File(None, description="Optional template DOCX file to use as base")
_FILE_UPLOAD = File(..., description="DOCX file to parse")
_FILE_STRUCTURED_TEMPLATE = File(..., description="Original DOCX template file")


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
    template_file: UploadFile = _FILE_TEMPLATE,
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
        if "title" in content_dict and content_dict["title"] is not None and not isinstance(content_dict["title"], str):
            title_type = type(content_dict["title"]).__name__
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid content: 'title' must be a string, got {title_type}",
            )

        if (
            "subtitle" in content_dict
            and content_dict["subtitle"] is not None
            and not isinstance(content_dict["subtitle"], str)
        ):
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

            valid_section_types = {"heading", "paragraph", "bullets", "numbered", "table", "quote", "code"}
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


_DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


@router.post("/from-markdown")
async def convert_markdown_to_docx(request: MarkdownToDocxRequest):
    """
    Convert Markdown content to DOCX.

    Parses markdown into HTML, then extracts structure (headings, paragraphs,
    lists, tables, etc.) and generates a Word document.

    Args:
        request: Markdown content

    Returns:
        DOCX file as binary response
    """
    try:
        docx_service = get_docx_service()
        docx_bytes = await docx_service.markdown_to_docx(request.content)

        return Response(
            content=docx_bytes,
            media_type=_DOCX_CONTENT_TYPE,
            headers={"Content-Disposition": "attachment; filename=document.docx"},
        )

    except Exception:
        logger.exception("Error converting markdown to DOCX")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to convert markdown to DOCX",
        ) from None


@router.post("/from-html")
async def convert_html_to_docx(request: HtmlToDocxRequest):
    """
    Convert HTML content to DOCX.

    Parses HTML to extract structure (headings, paragraphs, lists, tables, etc.)
    and generates a Word document.

    Args:
        request: HTML content

    Returns:
        DOCX file as binary response
    """
    try:
        docx_service = get_docx_service()
        docx_bytes = await docx_service.html_to_docx(request.html)

        return Response(
            content=docx_bytes,
            media_type=_DOCX_CONTENT_TYPE,
            headers={"Content-Disposition": "attachment; filename=document.docx"},
        )

    except Exception:
        logger.exception("Error converting HTML to DOCX")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to convert HTML to DOCX",
        ) from None


@router.post("/parse", response_model=ParseFileResponse)
async def parse_docx_file(
    file: UploadFile = _FILE_UPLOAD,
    user_input: str | None = Form(None, description="User instruction for AI extraction per section"),
    process_images: bool = Form(True, description="Extract and describe embedded images"),
    model: str | None = Form(None, description="LLM model for text processing"),
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
            model=model,
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


@router.post("/extract-structured", response_model=ExtractStructuredResponse)
async def extract_docx_structured(
    file: UploadFile = _FILE_UPLOAD,
):
    """
    Extract structured paragraph data from a DOCX file.

    Returns stable paragraph keys with text and editability flags,
    plus a source hash for validation during the apply step.

    Args:
        file: The DOCX file to extract structure from

    Returns:
        Structured extraction with source_hash, metadata, and lightweight paragraph list
    """
    try:
        file_bytes = await file.read()

        if not file_bytes:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Empty file uploaded",
            )

        service = get_docx_roundtrip_service()
        result = service.extract_structured(file_bytes, filename=file.filename)
        return ExtractStructuredResponse(**result)

    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e
    except HTTPException:
        raise
    except Exception:
        logger.exception("Error extracting structured DOCX")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to extract structured data from DOCX",
        ) from None


@router.post("/apply-structured", response_model=ApplyStructuredResponse)
async def apply_docx_structured(
    template_file: UploadFile = _FILE_STRUCTURED_TEMPLATE,
    params: str = Form(..., description="JSON parameters: {source_hash, modifications, track_changes?, author?}"),
):
    """
    Apply text modifications to a DOCX template, preserving all formatting.

    Takes the original DOCX file and a JSON params blob containing:
    - source_hash: SHA-256 hash from the extract step
    - modifications: Array of {key, text} objects
    - track_changes: Boolean (default false) — use Track Changes markup
    - author: String (default "AI Assistant") — author for Track Changes

    Returns the modified DOCX as base64 with a detailed report.
    """
    try:
        template_bytes = await template_file.read()

        if not template_bytes:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Empty template file uploaded",
            )

        try:
            params_dict = json.loads(params)
        except json.JSONDecodeError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid params JSON: {e!s}",
            ) from e

        if not isinstance(params_dict, dict):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"params must be a JSON object, got {type(params_dict).__name__}",
            )

        source_hash = params_dict.get("source_hash")
        if not source_hash or not isinstance(source_hash, str):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Missing or invalid 'source_hash' in params",
            )

        modifications = params_dict.get("modifications", [])
        if not isinstance(modifications, list):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="'modifications' must be an array",
            )
        if len(modifications) > _MAX_PARAGRAPHS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"modifications array exceeds maximum of {_MAX_PARAGRAPHS} entries",
            )

        track_changes = bool(params_dict.get("track_changes", False))
        author = params_dict.get("author", "AI Assistant")

        service = get_docx_roundtrip_service()
        docx_bytes, report = service.apply_structured(
            template_bytes=template_bytes,
            source_hash=source_hash,
            modifications=modifications,
            track_changes=track_changes,
            author=author,
        )

        file_base64 = base64.b64encode(docx_bytes).decode("utf-8")

        return ApplyStructuredResponse(
            success=report.get("success", True),
            file_base64=file_base64,
            file_size=len(docx_bytes),
            report=report,
        )

    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e
    except HTTPException:
        raise
    except Exception:
        logger.exception("Error applying structured modifications to DOCX")
        return ApplyStructuredResponse(
            success=False,
            error="Failed to apply structured modifications to DOCX",
        )


@router.post("/extract-metadata", response_model=FileMetadataResponse)
async def extract_docx_metadata(file: UploadFile = _FILE_UPLOAD):
    """Extract metadata from a DOCX file without full text extraction."""
    from app.services.file_parser_service import _extract_ooxml_metadata

    try:
        file_bytes = await file.read()
        if not file_bytes:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file uploaded")

        filename = file.filename or "unknown.docx"
        meta = _extract_ooxml_metadata(file_bytes, "docx")

        return FileMetadataResponse(
            success=True,
            filename=filename,
            file_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            title=meta["title"] or None,
            author=meta["author"] or None,
            created_at=meta["created_at"],
            modified_at=meta["modified_at"],
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Error extracting DOCX metadata")
        return FileMetadataResponse(
            success=False,
            filename=file.filename or "unknown",
            error="Failed to extract DOCX metadata",
        )

"""File extraction router — routes files to the correct extractor by extension."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from loguru import logger

from .image import SUPPORTED_IMAGE_EXTENSIONS
from .text import SUPPORTED_TEXT_EXTENSIONS

if TYPE_CHECKING:
    from tale_knowledge.vision.client import VisionClient

PDF_EXTENSIONS = {".pdf"}
DOCX_EXTENSIONS = {".docx"}
PPTX_EXTENSIONS = {".pptx"}
XLSX_EXTENSIONS = {".xlsx"}

ALL_SUPPORTED_EXTENSIONS = (
    PDF_EXTENSIONS
    | DOCX_EXTENSIONS
    | PPTX_EXTENSIONS
    | XLSX_EXTENSIONS
    | SUPPORTED_IMAGE_EXTENSIONS
    | SUPPORTED_TEXT_EXTENSIONS
)


def is_supported(filename: str) -> bool:
    """Check if a file extension is supported for extraction."""
    return Path(filename).suffix.lower() in ALL_SUPPORTED_EXTENSIONS


async def extract_text(
    file_bytes: bytes,
    filename: str,
    *,
    vision_client: VisionClient | None = None,
    process_images: bool = True,
    ocr_scanned_pages: bool = True,
) -> tuple[str, bool]:
    """Extract text from file bytes, routing to the correct extractor.

    Args:
        file_bytes: Raw file bytes.
        filename: Original filename (used to determine file type).
        vision_client: Optional VisionClient for OCR/image description.
        process_images: Whether to extract and describe embedded images.
        ocr_scanned_pages: Whether to OCR scanned PDF pages.

    Returns:
        Tuple of (extracted_text, vision_was_used).

    Raises:
        ValueError: If the file type is not supported.
        UnicodeDecodeError: If a text file cannot be decoded as UTF-8.
    """
    suffix = Path(filename).suffix.lower()

    if suffix in PDF_EXTENSIONS:
        from .pdf import extract_text_from_pdf_bytes

        return await extract_text_from_pdf_bytes(
            file_bytes,
            filename,
            vision_client=vision_client,
            process_images=process_images,
            ocr_scanned_pages=ocr_scanned_pages,
        )

    if suffix in DOCX_EXTENSIONS:
        from .docx import extract_text_from_docx_bytes

        return await extract_text_from_docx_bytes(
            file_bytes,
            filename,
            vision_client=vision_client,
            process_images=process_images,
        )

    if suffix in PPTX_EXTENSIONS:
        from .pptx import extract_text_from_pptx_bytes

        return await extract_text_from_pptx_bytes(
            file_bytes,
            filename,
            vision_client=vision_client,
            process_images=process_images,
        )

    if suffix in XLSX_EXTENSIONS:
        from .xlsx import extract_text_from_xlsx_bytes

        return await extract_text_from_xlsx_bytes(file_bytes, filename)

    if suffix in SUPPORTED_IMAGE_EXTENSIONS:
        from .image import extract_text_from_image_bytes

        return await extract_text_from_image_bytes(
            file_bytes,
            filename,
            vision_client=vision_client,
        )

    if suffix in SUPPORTED_TEXT_EXTENSIONS:
        from .text import extract_text_from_text_bytes

        return await extract_text_from_text_bytes(file_bytes, filename)

    logger.warning(f"Unsupported file type: {suffix}")
    raise ValueError(f"Unsupported file type: {suffix}")

"""Main Vision processor for document pre-processing.

This module provides the main entry point for Vision-based text extraction.
It routes different file types to appropriate extractors.
"""

from pathlib import Path

from loguru import logger

from .image_extractor import SUPPORTED_IMAGE_EXTENSIONS, extract_text_from_image
from .pdf_extractor import extract_text_from_pdf

# File extensions handled by Vision processing
PDF_EXTENSIONS = {".pdf"}

# Extensions passed through to Cognee (handled natively by unstructured)
PASSTHROUGH_EXTENSIONS = {".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls", ".txt", ".md", ".csv"}


def is_vision_supported(file_path: str | Path) -> bool:
    """Check if a file type is supported by Vision processing.

    Args:
        file_path: Path to the file

    Returns:
        True if the file should be processed by Vision
    """
    suffix = Path(file_path).suffix.lower()
    return suffix in PDF_EXTENSIONS or suffix in SUPPORTED_IMAGE_EXTENSIONS


def is_passthrough_type(file_path: str | Path) -> bool:
    """Check if a file type should be passed through to Cognee directly.

    Args:
        file_path: Path to the file

    Returns:
        True if the file should skip Vision processing
    """
    suffix = Path(file_path).suffix.lower()
    return suffix in PASSTHROUGH_EXTENSIONS


async def extract_text_from_document(
    file_path: str | Path,
    *,
    process_images: bool = True,
    ocr_scanned_pages: bool = True,
) -> tuple[str | None, bool]:
    """Extract text from a document using Vision API where applicable.

    This is the main entry point for Vision-based document processing.
    It routes files to appropriate handlers:
    - PDFs → Smart hybrid extraction with selective Vision API
    - Images → OCR or description via Vision API
    - DOCX/PPTX/XLSX → Returns None (passthrough to Cognee)

    Args:
        file_path: Path to the document file
        process_images: Whether to extract and describe embedded images
        ocr_scanned_pages: Whether to OCR scanned PDF pages

    Returns:
        Tuple of:
        - extracted_text: The extracted text, or None if passthrough
        - was_processed: True if Vision processing was applied

    Raises:
        FileNotFoundError: If the file does not exist
        ValueError: If the file type is not supported
    """
    file_path = Path(file_path)

    if not file_path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    suffix = file_path.suffix.lower()

    # Check if this is a passthrough type
    if is_passthrough_type(file_path):
        logger.debug(f"Passthrough file type: {suffix}")
        return None, False

    # PDF processing
    if suffix in PDF_EXTENSIONS:
        logger.info(f"Processing PDF with Vision: {file_path.name}")
        return await extract_text_from_pdf(
            file_path,
            process_images=process_images,
            ocr_scanned_pages=ocr_scanned_pages,
        )

    # Image processing
    if suffix in SUPPORTED_IMAGE_EXTENSIONS:
        logger.info(f"Processing image with Vision: {file_path.name}")
        return await extract_text_from_image(file_path)

    # Unknown type
    logger.warning(f"Unsupported file type for Vision: {suffix}")
    raise ValueError(f"Unsupported file type: {suffix}")


async def extract_text_from_bytes(
    content: bytes,
    filename: str,
    *,
    process_images: bool = True,
    ocr_scanned_pages: bool = True,
) -> tuple[str | None, bool]:
    """Extract text from document bytes using Vision API where applicable.

    Args:
        content: Raw file bytes
        filename: Original filename (used to determine file type)
        process_images: Whether to extract and describe embedded images
        ocr_scanned_pages: Whether to OCR scanned PDF pages

    Returns:
        Tuple of:
        - extracted_text: The extracted text, or None if passthrough
        - was_processed: True if Vision processing was applied
    """
    suffix = Path(filename).suffix.lower()

    # Check if this is a passthrough type
    if suffix in PASSTHROUGH_EXTENSIONS:
        logger.debug(f"Passthrough file type: {suffix}")
        return None, False

    # PDF processing
    if suffix in PDF_EXTENSIONS:
        from .pdf_extractor import extract_text_from_pdf_bytes

        logger.info(f"Processing PDF bytes with Vision: {filename}")
        return await extract_text_from_pdf_bytes(
            content,
            filename,
            process_images=process_images,
            ocr_scanned_pages=ocr_scanned_pages,
        )

    # Image processing
    if suffix in SUPPORTED_IMAGE_EXTENSIONS:
        from .image_extractor import extract_text_from_image_bytes

        logger.info(f"Processing image bytes with Vision: {filename}")
        return await extract_text_from_image_bytes(content, filename)

    # Unknown type
    logger.warning(f"Unsupported file type for Vision: {suffix}")
    raise ValueError(f"Unsupported file type: {suffix}")

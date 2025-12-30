"""Image file text extraction using Vision API.

This module handles direct image files (PNG, JPG, etc.) by:
1. Checking if the image contains text (document scan) → OCR
2. Otherwise → Generate description for indexing
"""

from pathlib import Path

from loguru import logger

from .openai_client import vision_client

# Supported image extensions
SUPPORTED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".tif"}

# Minimum characters to consider OCR result as meaningful text
MIN_OCR_TEXT_LENGTH = 20


def is_supported_image(file_path: str | Path) -> bool:
    """Check if a file is a supported image format."""
    return Path(file_path).suffix.lower() in SUPPORTED_IMAGE_EXTENSIONS


async def extract_text_from_image(
    file_path: str | Path,
) -> tuple[str, bool]:
    """Extract text from an image file using Vision API.

    First attempts OCR. If no significant text is found,
    generates a description of the image for indexing.

    Args:
        file_path: Path to the image file

    Returns:
        Tuple of (extracted_text, was_processed_with_vision)
    """
    file_path = Path(file_path)
    if not file_path.exists():
        raise FileNotFoundError(f"Image file not found: {file_path}")

    logger.info(f"Processing image: {file_path.name}")

    # Read image bytes
    image_bytes = file_path.read_bytes()

    return await extract_text_from_image_bytes(image_bytes, file_path.name)


async def extract_text_from_image_bytes(
    image_bytes: bytes,
    filename: str = "image",
) -> tuple[str, bool]:
    """Extract text from image bytes using Vision API.

    First attempts OCR. If no significant text is found,
    generates a description of the image for indexing.

    Args:
        image_bytes: Raw image bytes
        filename: Optional filename for logging

    Returns:
        Tuple of (extracted_text, was_processed_with_vision)
    """
    logger.info(f"Processing image from bytes: {filename}")

    # First, try OCR to extract any text
    try:
        ocr_text = await vision_client.ocr_image(image_bytes)

        # If we got meaningful text, return it
        if ocr_text and len(ocr_text.strip()) > MIN_OCR_TEXT_LENGTH:
            logger.info(f"Image OCR successful: {len(ocr_text)} chars extracted")
            return ocr_text, True

    except Exception as e:
        logger.warning(f"Image OCR failed, falling back to description: {e}")

    # No text found, generate a description
    try:
        description = await vision_client.describe_image(image_bytes)
        if description:
            result = f"[Image: {description}]"
            logger.info(f"Generated image description: {len(description)} chars")
            return result, True

    except Exception as e:
        logger.error(f"Failed to describe image: {e}")
        raise

    # Fallback - return empty with vision flag
    return "", True

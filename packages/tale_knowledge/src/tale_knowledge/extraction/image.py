"""Image file text extraction using Vision API.

Handles direct image files (PNG, JPG, etc.) by:
1. Attempting OCR to extract text (document scan detection)
2. Falling back to description generation for indexing
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from loguru import logger

if TYPE_CHECKING:
    from tale_knowledge.vision.client import VisionClient

SUPPORTED_IMAGE_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".bmp",
    ".tiff",
    ".tif",
}

MIN_OCR_TEXT_LENGTH = 20


async def extract_text_from_image_bytes(
    image_bytes: bytes,
    filename: str = "image",
    *,
    vision_client: VisionClient | None = None,
) -> tuple[str, bool]:
    """Extract text from image bytes using Vision API.

    First attempts OCR. If no significant text is found,
    generates a description of the image for indexing.

    Args:
        image_bytes: Raw image bytes.
        filename: Filename for logging.
        vision_client: VisionClient instance. If None, returns empty.

    Returns:
        Tuple of (extracted_text, vision_was_used).
    """
    if not vision_client:
        logger.warning(f"No vision client provided for image extraction: {filename}")
        return "", False

    logger.info(f"Processing image: {filename}")

    ocr_text = await vision_client.ocr_image(image_bytes)

    if ocr_text and len(ocr_text.strip()) > MIN_OCR_TEXT_LENGTH:
        logger.info(f"Image OCR successful: {len(ocr_text)} chars extracted")
        return ocr_text, True

    description = await vision_client.describe_image(image_bytes)
    if description:
        result = f"[Image: {description}]"
        logger.info(f"Generated image description: {len(description)} chars")
        return result, True

    return "", True

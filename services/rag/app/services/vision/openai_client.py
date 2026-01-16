"""OpenAI Vision API client for OCR and image description.

This module provides a wrapper around the OpenAI Vision API for:
- OCR: Extracting text from scanned/image-based PDF pages
- Image description: Generating descriptions of photos, charts, diagrams
"""

import base64
import imghdr
from typing import Optional

from loguru import logger
from openai import AsyncOpenAI

from ...config import settings


def _detect_mime_type(image_bytes: bytes) -> str:
    """Detect MIME type from image bytes.

    Args:
        image_bytes: Raw image bytes

    Returns:
        MIME type string (e.g., "image/png", "image/jpeg")
    """
    img_type = imghdr.what(None, h=image_bytes)
    mime_map = {
        "png": "image/png",
        "jpeg": "image/jpeg",
        "gif": "image/gif",
        "webp": "image/webp",
        "bmp": "image/bmp",
        "tiff": "image/tiff",
    }
    return mime_map.get(img_type, "image/png")

# Default prompts for Vision API
OCR_PROMPT = """Extract ALL text from this document image.
Preserve the original layout and formatting as much as possible.
Include headers, paragraphs, lists, tables, and any other text content.
If there's no readable text, respond with "[No text found]".
Return ONLY the extracted text, nothing else."""

DESCRIBE_PROMPT = """Briefly describe this image in 1-2 short sentences (max 150 characters).
Focus on: image type (photo/chart/diagram), main subject, and key visible text.
Be extremely concise - omit minor details."""


class VisionClient:
    """Async client for OpenAI Vision API calls."""

    def __init__(self) -> None:
        """Initialize the Vision client."""
        self._client: Optional[AsyncOpenAI] = None

    def _get_client(self) -> AsyncOpenAI:
        """Get or create the OpenAI client."""
        if self._client is None:
            llm_config = settings.get_llm_config()
            self._client = AsyncOpenAI(
                api_key=llm_config.get("api_key"),
                base_url=llm_config.get("base_url"),
                timeout=120.0,  # Vision API can take longer
            )
        return self._client

    async def ocr_image(
        self,
        image_bytes: bytes,
        prompt: Optional[str] = None,
    ) -> str:
        """Extract text from a scanned document image using Vision API.

        Args:
            image_bytes: Raw image bytes (PNG, JPG, etc.)
            prompt: Custom OCR prompt (uses default if not provided)

        Returns:
            Extracted text from the image
        """
        client = self._get_client()
        vision_model = settings.get_vision_model()
        extraction_prompt = prompt or settings.vision_extraction_prompt or OCR_PROMPT

        # Encode image to base64 and detect MIME type
        image_b64 = base64.b64encode(image_bytes).decode("utf-8")
        mime_type = _detect_mime_type(image_bytes)

        logger.debug(f"Sending OCR request to {vision_model}")

        try:
            response = await client.chat.completions.create(
                model=vision_model,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": extraction_prompt},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:{mime_type};base64,{image_b64}",
                                },
                            },
                        ],
                    }
                ],
                max_tokens=4096,
            )

            if not response.choices:
                logger.warning("Vision API returned empty choices for OCR")
                return ""

            result = response.choices[0].message.content or ""

            # Handle "no text found" responses
            if result.strip().lower() in ["[no text found]", "no text found", ""]:
                return ""

            logger.debug(f"OCR extracted {len(result)} characters")
            return result

        except Exception as e:
            logger.error(f"Vision API OCR request failed: {e}")
            raise

    async def describe_image(
        self,
        image_bytes: bytes,
        prompt: Optional[str] = None,
    ) -> str:
        """Generate a description of an image for indexing.

        Args:
            image_bytes: Raw image bytes (PNG, JPG, etc.)
            prompt: Custom description prompt (uses default if not provided)

        Returns:
            Description of the image content
        """
        client = self._get_client()
        vision_model = settings.get_vision_model()
        description_prompt = prompt or DESCRIBE_PROMPT

        # Encode image to base64 and detect MIME type
        image_b64 = base64.b64encode(image_bytes).decode("utf-8")
        mime_type = _detect_mime_type(image_bytes)

        logger.debug(f"Sending image description request to {vision_model}")

        try:
            response = await client.chat.completions.create(
                model=vision_model,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": description_prompt},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:{mime_type};base64,{image_b64}",
                                },
                            },
                        ],
                    }
                ],
                max_tokens=100,
            )

            if not response.choices:
                logger.warning("Vision API returned empty choices for description")
                return ""

            result = response.choices[0].message.content or ""
            logger.debug(f"Generated image description: {len(result)} characters")
            return result.strip()

        except Exception as e:
            logger.error(f"Vision API description request failed: {e}")
            raise


# Singleton instance
vision_client = VisionClient()

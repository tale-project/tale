"""OpenAI Vision API client for OCR and image description.

Constructor-injected configuration — no global state or settings imports.
Each service creates its own VisionClient instance with its own config.
"""

import asyncio
import base64

from loguru import logger
from openai import AsyncOpenAI

from .cache import VisionCache

OCR_PROMPT = """Extract ALL text from this document image.
Preserve the original layout and formatting as much as possible.
Include headers, paragraphs, lists, tables, and any other text content.
If there's no readable text, respond with "[No text found]".
Return ONLY the extracted text, nothing else."""

DESCRIBE_PROMPT = """Briefly describe this image in 1-2 short sentences (max 150 characters).
Focus on: image type (photo/chart/diagram), main subject, and key visible text.
Be extremely concise - omit minor details."""

_MAGIC_BYTES = {
    b"\x89PNG": "image/png",
    b"\xff\xd8\xff": "image/jpeg",
    b"GIF8": "image/gif",
    b"RIFF": "image/webp",
    b"BM": "image/bmp",
    b"II\x2a\x00": "image/tiff",
    b"MM\x00\x2a": "image/tiff",
}


def _detect_mime_type(image_bytes: bytes) -> str:
    for magic, mime in _MAGIC_BYTES.items():
        if image_bytes.startswith(magic):
            if magic == b"RIFF":
                if image_bytes[8:12] == b"WEBP":
                    return mime
                continue
            return mime
    return "image/png"


class VisionClient:
    """Async client for OpenAI Vision API calls.

    All configuration is passed via the constructor — no global settings dependency.
    """

    def __init__(
        self,
        api_key: str,
        model: str,
        *,
        base_url: str | None = None,
        timeout: float = 120.0,
        request_timeout: float = 120.0,
        max_concurrent_pages: int = 3,
        pdf_dpi: int = 200,
        ocr_prompt: str | None = None,
        describe_prompt: str | None = None,
        cache: VisionCache | None = None,
    ) -> None:
        self._client = AsyncOpenAI(api_key=api_key, base_url=base_url, timeout=timeout)
        self._model = model
        self._request_timeout = request_timeout
        self._max_concurrent_pages = max_concurrent_pages
        self._pdf_dpi = pdf_dpi
        self._ocr_prompt = ocr_prompt or OCR_PROMPT
        self._describe_prompt = describe_prompt or DESCRIBE_PROMPT
        self._cache = cache or VisionCache()

    @property
    def cache(self) -> VisionCache:
        return self._cache

    @property
    def max_concurrent_pages(self) -> int:
        return self._max_concurrent_pages

    @property
    def pdf_dpi(self) -> int:
        return self._pdf_dpi

    async def ocr_image(self, image_bytes: bytes, prompt: str | None = None) -> str:
        """Extract text from a scanned document image using Vision API."""
        cached_result, image_hash = self._cache.get_ocr(image_bytes)
        if cached_result is not None:
            return cached_result

        extraction_prompt = prompt or self._ocr_prompt
        image_b64 = base64.b64encode(image_bytes).decode("utf-8")
        mime_type = _detect_mime_type(image_bytes)

        logger.debug(f"Sending OCR request to {self._model}")

        try:
            response = await asyncio.wait_for(
                self._client.chat.completions.create(
                    model=self._model,
                    messages=[
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": extraction_prompt},
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": f"data:{mime_type};base64,{image_b64}"
                                    },
                                },
                            ],
                        }
                    ],
                    max_tokens=4096,
                ),
                timeout=self._request_timeout,
            )

            if not response.choices:
                logger.warning("Vision API returned empty choices for OCR")
                self._cache.set_ocr(image_hash, "")
                return ""

            result = response.choices[0].message.content or ""

            if result.strip().lower() in ["[no text found]", "no text found", ""]:
                self._cache.set_ocr(image_hash, "")
                return ""

            logger.debug(f"OCR extracted {len(result)} characters")
            self._cache.set_ocr(image_hash, result)
            await asyncio.sleep(1)
            return result

        except TimeoutError:
            raise TimeoutError(
                f"Vision API OCR request timed out after {self._request_timeout}s"
            ) from None
        except Exception as e:
            logger.error(f"Vision API OCR request failed: {e}")
            raise

    async def describe_image(
        self, image_bytes: bytes, prompt: str | None = None
    ) -> str:
        """Generate a description of an image for indexing."""
        cached_result, image_hash = self._cache.get_description(image_bytes)
        if cached_result is not None:
            return cached_result

        description_prompt = prompt or self._describe_prompt
        image_b64 = base64.b64encode(image_bytes).decode("utf-8")
        mime_type = _detect_mime_type(image_bytes)

        logger.debug(f"Sending image description request to {self._model}")

        try:
            response = await asyncio.wait_for(
                self._client.chat.completions.create(
                    model=self._model,
                    messages=[
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": description_prompt},
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": f"data:{mime_type};base64,{image_b64}"
                                    },
                                },
                            ],
                        }
                    ],
                    max_tokens=100,
                ),
                timeout=self._request_timeout,
            )

            if not response.choices:
                logger.warning("Vision API returned empty choices for description")
                self._cache.set_description(image_hash, "")
                return ""

            result = (response.choices[0].message.content or "").strip()
            logger.debug(f"Generated image description: {len(result)} characters")
            self._cache.set_description(image_hash, result)
            await asyncio.sleep(1)
            return result

        except TimeoutError:
            raise TimeoutError(
                f"Vision API describe_image request timed out after {self._request_timeout}s"
            ) from None
        except Exception as e:
            logger.error(f"Vision API description request failed: {e}")
            raise

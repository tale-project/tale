"""OpenAI Vision API client for OCR and image description.

This module provides a wrapper around the OpenAI Vision API for:
- OCR: Extracting text from scanned/image-based document pages
- Image description: Generating descriptions of photos, charts, diagrams
- LLM extraction: Processing page content with user instructions

Results are cached based on image content hash to avoid redundant API calls.
"""

import asyncio
import base64
import imghdr

from loguru import logger
from openai import AsyncOpenAI

from ...config import settings
from .cache import vision_cache


def _detect_mime_type(image_bytes: bytes) -> str:
    """Detect MIME type from image bytes."""
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
        self._client: AsyncOpenAI | None = None

    def _get_client(self) -> AsyncOpenAI:
        """Get or create the OpenAI client."""
        if self._client is None:
            self._client = AsyncOpenAI(
                api_key=settings.get_openai_api_key(),
                base_url=settings.get_openai_base_url(),
                timeout=120.0,
            )
        return self._client

    async def ocr_image(
        self,
        image_bytes: bytes,
        prompt: str | None = None,
    ) -> str:
        """Extract text from a scanned document image using Vision API.

        Args:
            image_bytes: Raw image bytes (PNG, JPG, etc.)
            prompt: Custom OCR prompt (uses default if not provided)

        Returns:
            Extracted text from the image
        """
        cached_result, image_hash = vision_cache.get_ocr(image_bytes)
        if cached_result is not None:
            return cached_result

        client = self._get_client()
        vision_model = settings.get_vision_model()
        extraction_prompt = prompt or OCR_PROMPT

        image_b64 = base64.b64encode(image_bytes).decode("utf-8")
        mime_type = _detect_mime_type(image_bytes)

        logger.debug(f"Sending OCR request to {vision_model}")

        try:
            response = await asyncio.wait_for(
                client.chat.completions.create(
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
                ),
                timeout=settings.vision_request_timeout,
            )

            if not response.choices:
                logger.warning("Vision API returned empty choices for OCR")
                vision_cache.set_ocr(image_hash, "")
                return ""

            result = response.choices[0].message.content or ""

            if result.strip().lower() in ["[no text found]", "no text found", ""]:
                vision_cache.set_ocr(image_hash, "")
                return ""

            logger.debug(f"OCR extracted {len(result)} characters")
            vision_cache.set_ocr(image_hash, result)

            await asyncio.sleep(1)

            return result

        except TimeoutError:
            raise TimeoutError(
                f"Vision API OCR request timed out after {settings.vision_request_timeout}s"
            )
        except Exception as e:
            logger.error(f"Vision API OCR request failed: {e}")
            raise

    async def describe_image(
        self,
        image_bytes: bytes,
        prompt: str | None = None,
    ) -> str:
        """Generate a description of an image for indexing.

        Args:
            image_bytes: Raw image bytes (PNG, JPG, etc.)
            prompt: Custom description prompt (uses default if not provided)

        Returns:
            Description of the image content
        """
        cached_result, image_hash = vision_cache.get_description(image_bytes)
        if cached_result is not None:
            return cached_result

        client = self._get_client()
        vision_model = settings.get_vision_model()
        description_prompt = prompt or DESCRIBE_PROMPT

        image_b64 = base64.b64encode(image_bytes).decode("utf-8")
        mime_type = _detect_mime_type(image_bytes)

        logger.debug(f"Sending image description request to {vision_model}")

        try:
            response = await asyncio.wait_for(
                client.chat.completions.create(
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
                ),
                timeout=settings.vision_request_timeout,
            )

            if not response.choices:
                logger.warning("Vision API returned empty choices for description")
                vision_cache.set_description(image_hash, "")
                return ""

            result = (response.choices[0].message.content or "").strip()
            logger.debug(f"Generated image description: {len(result)} characters")
            vision_cache.set_description(image_hash, result)

            return result

        except TimeoutError:
            raise TimeoutError(
                f"Vision API describe_image request timed out after {settings.vision_request_timeout}s"
            )
        except Exception as e:
            logger.error(f"Vision API description request failed: {e}")
            raise


def _chunk_by_chars(
    full_text: str,
    max_chars: int = 100_000,
) -> list[tuple[int, str]]:
    """Split text into chunks by character count.

    Tries to split at paragraph boundaries (double newlines) to avoid
    breaking sentences mid-way.

    Args:
        full_text: Complete text to split
        max_chars: Maximum characters per chunk (default 100k)

    Returns:
        List of (chunk_index, chunk_content) tuples
    """
    if len(full_text) <= max_chars:
        return [(0, full_text)]

    chunks: list[tuple[int, str]] = []
    remaining = full_text
    chunk_idx = 0

    while remaining:
        if len(remaining) <= max_chars:
            chunks.append((chunk_idx, remaining.strip()))
            break

        # Try to find a good split point (paragraph boundary)
        split_pos = max_chars
        search_start = max(0, max_chars - 5000)  # Look back up to 5k chars

        # Look for double newline (paragraph break)
        para_break = remaining.rfind("\n\n", search_start, max_chars)
        if para_break > search_start:
            split_pos = para_break + 2  # Include the newlines
        else:
            # Fall back to single newline
            line_break = remaining.rfind("\n", search_start, max_chars)
            if line_break > search_start:
                split_pos = line_break + 1

        chunk_text = remaining[:split_pos].strip()
        if chunk_text:
            chunks.append((chunk_idx, chunk_text))
            chunk_idx += 1

        remaining = remaining[split_pos:]

    return chunks


async def process_pages_with_llm(
    pages_content: list[str],
    user_input: str,
    max_concurrent: int = 3,
    max_chars_per_chunk: int = 100_000,
) -> list[str]:
    """Process document content with Fast LLM based on user instruction.

    First merges all pages into a single text, then splits by character count
    (default 100k per chunk) for efficient LLM processing.

    Args:
        pages_content: List of page text contents
        user_input: User instruction for extraction
        max_concurrent: Maximum concurrent API calls
        max_chars_per_chunk: Maximum characters per chunk (default 100k)

    Returns:
        List of processed chunk contents
    """
    if not pages_content:
        return []

    # Merge all pages into one text block
    full_text = "\n\n".join(pages_content)
    total_chars = len(full_text)

    logger.info(f"LLM processing: {total_chars} chars total, chunking at {max_chars_per_chunk} chars")

    client = AsyncOpenAI(
        api_key=settings.get_openai_api_key(),
        base_url=settings.get_openai_base_url(),
        timeout=180.0,
    )
    fast_model = settings.get_fast_model()
    semaphore = asyncio.Semaphore(max_concurrent)

    chunks = _chunk_by_chars(full_text, max_chars_per_chunk)
    total_chunks = len(chunks)

    logger.info(f"Split into {total_chunks} chunks for LLM processing")

    async def process_chunk(chunk_idx: int, chunk_text: str) -> tuple[int, str]:
        async with semaphore:
            try:
                logger.debug(f"Processing chunk {chunk_idx + 1}/{total_chunks} ({len(chunk_text)} chars)")
                response = await client.chat.completions.create(
                    model=fast_model,
                    messages=[
                        {
                            "role": "system",
                            "content": "Extract information from the following document content based on user instruction. Return only the extracted information.",
                        },
                        {
                            "role": "user",
                            "content": f"Instruction: {user_input}\n\nDocument content:\n{chunk_text}",
                        },
                    ],
                )
                result = response.choices[0].message.content or ""
                logger.info(
                    f"LLM chunk {chunk_idx + 1}/{total_chunks} done: {len(chunk_text)} -> {len(result)} chars"
                )
                return chunk_idx, result
            except Exception as e:
                logger.warning(f"Failed to process chunk {chunk_idx + 1} with LLM: {e}")
                return chunk_idx, chunk_text

    tasks = [process_chunk(idx, text) for idx, text in chunks]
    results = await asyncio.gather(*tasks)

    results.sort(key=lambda x: x[0])
    return [r[1] for r in results]


vision_client = VisionClient()

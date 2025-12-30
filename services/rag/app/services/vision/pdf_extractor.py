"""Smart PDF text extraction with selective Vision API usage.

This module implements a hybrid approach for PDF processing:
1. Digital PDFs: Extract text directly using PyMuPDF (no API calls)
2. Scanned PDFs: Detect low-text pages and send to Vision API for OCR
3. Embedded images: Extract and describe using Vision API

This approach minimizes API costs while still handling scanned documents.
"""

import asyncio
from io import BytesIO
from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF
from loguru import logger

from ...config import settings
from .openai_client import vision_client

# Minimum characters to consider a page as having extractable text
MIN_TEXT_THRESHOLD = 50

# Minimum image size (width * height) to process
MIN_IMAGE_SIZE = 10000  # ~100x100 pixels


async def extract_text_from_pdf(
    file_path: str | Path,
    *,
    process_images: bool = True,
    ocr_scanned_pages: bool = True,
) -> tuple[str, bool]:
    """Extract text from a PDF file using smart hybrid approach.

    For each page:
    1. Extract text directly using PyMuPDF
    2. If text is below threshold (scanned page), use Vision API for OCR
    3. Extract and describe embedded images using Vision API

    Args:
        file_path: Path to the PDF file
        process_images: Whether to extract and describe embedded images
        ocr_scanned_pages: Whether to OCR pages with low text content

    Returns:
        Tuple of (extracted_text, was_processed_with_vision)
    """
    file_path = Path(file_path)
    if not file_path.exists():
        raise FileNotFoundError(f"PDF file not found: {file_path}")

    logger.info(f"Processing PDF: {file_path.name}")

    with fitz.open(file_path) as doc:
        total_pages = len(doc)
        pages_text: list[str] = []
        semaphore = asyncio.Semaphore(settings.vision_max_concurrent_pages)

        async def process_page(page_num: int) -> tuple[str, bool]:
            """Process a single page and return its text content and vision usage flag."""
            page_vision_used = False
            page = doc[page_num]
            page_parts: list[str] = []

            # 1. Extract text directly from the page
            direct_text = page.get_text("text").strip()

            # 2. Check if this is a scanned page (low text content)
            if len(direct_text) < MIN_TEXT_THRESHOLD and ocr_scanned_pages:
                logger.debug(
                    f"Page {page_num + 1}: Low text ({len(direct_text)} chars), "
                    "sending to Vision API for OCR"
                )
                ocr_text = await _ocr_page(page, semaphore)
                if ocr_text:
                    page_parts.append(ocr_text)
                    page_vision_used = True
                elif direct_text:
                    # Fallback to direct text if OCR returns nothing
                    page_parts.append(direct_text)
            else:
                # Page has sufficient text, use it directly
                if direct_text:
                    page_parts.append(direct_text)

            # 3. Extract and describe embedded images
            if process_images:
                image_descriptions = await _extract_image_descriptions(page, semaphore)
                if image_descriptions:
                    page_vision_used = True
                    for desc in image_descriptions:
                        page_parts.append(f"\n[Image: {desc}]\n")

            return "\n".join(page_parts), page_vision_used

        # Process all pages concurrently (with semaphore limiting)
        tasks = [process_page(i) for i in range(total_pages)]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Collect results and aggregate vision_used flag
        vision_used = False
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(f"Failed to process page {i + 1}: {result}")
                # Try to get at least the direct text on error
                try:
                    fallback_text = doc[i].get_text("text").strip()
                    if fallback_text:
                        pages_text.append(f"--- Page {i + 1} ---\n{fallback_text}")
                except Exception:
                    pages_text.append(f"--- Page {i + 1} ---\n[Error processing page]")
            else:
                page_text, page_vision_used = result
                if page_vision_used:
                    vision_used = True
                if page_text:
                    pages_text.append(f"--- Page {i + 1} ---\n{page_text}")

        combined_text = "\n\n".join(pages_text)
        logger.info(
            f"PDF processing complete: {total_pages} pages, "
            f"{len(combined_text)} chars, Vision API used: {vision_used}"
        )

        return combined_text, vision_used


async def _ocr_page(
    page: fitz.Page,
    semaphore: asyncio.Semaphore,
) -> str:
    """Render a page as image and OCR it using Vision API.

    Args:
        page: PyMuPDF page object
        semaphore: Concurrency limiter

    Returns:
        OCR'd text from the page
    """
    async with semaphore:
        try:
            # Render page as image at configured DPI
            dpi = settings.vision_pdf_dpi
            mat = fitz.Matrix(dpi / 72, dpi / 72)
            pixmap = page.get_pixmap(matrix=mat)

            # Convert to PNG bytes
            image_bytes = pixmap.tobytes("png")

            # Send to Vision API for OCR
            return await vision_client.ocr_image(image_bytes)

        except Exception as e:
            logger.error(f"Failed to OCR page: {e}")
            return ""


async def _extract_image_descriptions(
    page: fitz.Page,
    semaphore: asyncio.Semaphore,
) -> list[str]:
    """Extract embedded images from a page and describe them.

    Args:
        page: PyMuPDF page object
        semaphore: Concurrency limiter

    Returns:
        List of image descriptions
    """
    descriptions: list[str] = []

    try:
        image_list = page.get_images(full=True)

        if not image_list:
            return descriptions

        doc = page.parent

        for img_index, img_info in enumerate(image_list):
            xref = img_info[0]

            try:
                # Extract image bytes
                base_image = doc.extract_image(xref)
                if not base_image:
                    continue

                image_bytes = base_image.get("image")
                if not image_bytes:
                    continue

                # Check image size
                width = base_image.get("width", 0)
                height = base_image.get("height", 0)
                if width * height < MIN_IMAGE_SIZE:
                    logger.debug(
                        f"Skipping small image ({width}x{height}) on page {page.number + 1}"
                    )
                    continue

                # Get image description
                async with semaphore:
                    description = await vision_client.describe_image(image_bytes)
                    if description:
                        descriptions.append(description)

            except Exception as e:
                logger.warning(
                    f"Failed to extract/describe image {img_index} "
                    f"on page {page.number + 1}: {e}"
                )
                continue

    except Exception as e:
        logger.error(f"Failed to extract images from page {page.number + 1}: {e}")

    return descriptions


async def extract_text_from_pdf_bytes(
    pdf_bytes: bytes,
    filename: str = "document.pdf",
    *,
    process_images: bool = True,
    ocr_scanned_pages: bool = True,
) -> tuple[str, bool]:
    """Extract text from PDF bytes.

    Args:
        pdf_bytes: Raw PDF bytes
        filename: Optional filename for logging
        process_images: Whether to extract and describe embedded images
        ocr_scanned_pages: Whether to OCR pages with low text content

    Returns:
        Tuple of (extracted_text, was_processed_with_vision)
    """
    logger.info(f"Processing PDF from bytes: {filename}")

    with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
        total_pages = len(doc)
        pages_text: list[str] = []
        semaphore = asyncio.Semaphore(settings.vision_max_concurrent_pages)

        async def process_page(page_num: int) -> tuple[str, bool]:
            """Process a single page and return its text content and vision usage flag."""
            page_vision_used = False
            page = doc[page_num]
            page_parts: list[str] = []

            # 1. Extract text directly from the page
            direct_text = page.get_text("text").strip()

            # 2. Check if this is a scanned page (low text content)
            if len(direct_text) < MIN_TEXT_THRESHOLD and ocr_scanned_pages:
                logger.debug(
                    f"Page {page_num + 1}: Low text ({len(direct_text)} chars), "
                    "sending to Vision API for OCR"
                )
                ocr_text = await _ocr_page(page, semaphore)
                if ocr_text:
                    page_parts.append(ocr_text)
                    page_vision_used = True
                elif direct_text:
                    page_parts.append(direct_text)
            else:
                if direct_text:
                    page_parts.append(direct_text)

            # 3. Extract and describe embedded images
            if process_images:
                image_descriptions = await _extract_image_descriptions(page, semaphore)
                if image_descriptions:
                    page_vision_used = True
                    for desc in image_descriptions:
                        page_parts.append(f"\n[Image: {desc}]\n")

            return "\n".join(page_parts), page_vision_used

        tasks = [process_page(i) for i in range(total_pages)]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Collect results and aggregate vision_used flag
        vision_used = False
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(f"Failed to process page {i + 1}: {result}")
                try:
                    fallback_text = doc[i].get_text("text").strip()
                    if fallback_text:
                        pages_text.append(f"--- Page {i + 1} ---\n{fallback_text}")
                except Exception:
                    pages_text.append(f"--- Page {i + 1} ---\n[Error processing page]")
            else:
                page_text, page_vision_used = result
                if page_vision_used:
                    vision_used = True
                if page_text:
                    pages_text.append(f"--- Page {i + 1} ---\n{page_text}")

        combined_text = "\n\n".join(pages_text)
        logger.info(
            f"PDF processing complete: {total_pages} pages, "
            f"{len(combined_text)} chars, Vision API used: {vision_used}"
        )

        return combined_text, vision_used

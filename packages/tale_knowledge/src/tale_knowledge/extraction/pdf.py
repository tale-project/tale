"""Smart PDF text extraction with selective Vision API usage.

Hybrid approach:
1. Digital PDFs: Extract text directly using PyMuPDF (no API calls)
2. Scanned PDFs: Detect low-text pages and send to Vision API for OCR
3. Embedded images: Extract and describe using Vision API
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

import fitz  # PyMuPDF
from loguru import logger

if TYPE_CHECKING:
    from tale_knowledge.vision.client import VisionClient

MIN_TEXT_THRESHOLD = 50
MIN_IMAGE_SIZE = 10000  # ~100x100 pixels


async def _ocr_page(
    page: fitz.Page,
    semaphore: asyncio.Semaphore,
    vision_client: VisionClient,
) -> str:
    async with semaphore:
        try:
            dpi = vision_client.pdf_dpi
            mat = fitz.Matrix(dpi / 72, dpi / 72)
            pixmap = page.get_pixmap(matrix=mat)
            image_bytes = pixmap.tobytes("png")
            return await vision_client.ocr_image(image_bytes)
        except Exception as e:
            logger.warning(f"Failed to OCR page, returning empty text: {e}")
            return ""


async def _describe_image(
    doc: fitz.Document,
    xref: int,
    semaphore: asyncio.Semaphore,
    vision_client: VisionClient,
) -> str:
    async with semaphore:
        try:
            base_image = doc.extract_image(xref)
            if not base_image:
                return ""

            image_bytes = base_image.get("image")
            if not image_bytes:
                return ""

            width = base_image.get("width", 0)
            height = base_image.get("height", 0)
            if width * height < MIN_IMAGE_SIZE:
                logger.debug(f"Skipping small image ({width}x{height})")
                return ""

            return await vision_client.describe_image(image_bytes)
        except Exception as e:
            logger.warning(f"Failed to describe image xref={xref}: {e}")
            return ""


async def _extract_page_with_layout(
    page: fitz.Page,
    doc: fitz.Document,
    semaphore: asyncio.Semaphore,
    vision_client: VisionClient | None,
    process_images: bool,
    ocr_scanned_pages: bool,
) -> tuple[str, bool]:
    """Extract page content preserving text and image positions."""
    elements: list[tuple[float, str]] = []
    vision_used = False

    text_dict = page.get_text("dict")
    total_text_len = 0

    for block in text_dict.get("blocks", []):
        if block.get("type") == 0:
            y0 = block.get("bbox", [0, 0, 0, 0])[1]
            lines_text = []
            for line in block.get("lines", []):
                spans_text = "".join(
                    span.get("text", "") for span in line.get("spans", [])
                )
                lines_text.append(spans_text)
            text = "\n".join(lines_text).strip()
            if text:
                elements.append((y0, text))
                total_text_len += len(text)

    if total_text_len < MIN_TEXT_THRESHOLD and ocr_scanned_pages and vision_client:
        logger.debug(
            f"Page {page.number + 1}: Low text ({total_text_len} chars), sending to Vision API for OCR"
        )
        ocr_text = await _ocr_page(page, semaphore, vision_client)
        if ocr_text:
            elements = [(0, ocr_text)]
            vision_used = True

    if process_images and vision_client:
        image_list = page.get_images(full=True)
        for img_info in image_list:
            xref = img_info[0]
            try:
                bbox_list = page.get_image_rects(xref)
                y0 = bbox_list[0].y0 if bbox_list else float("inf")
                description = await _describe_image(doc, xref, semaphore, vision_client)
                if description:
                    elements.append((y0, f"[Image: {description}]"))
                    vision_used = True
            except Exception as e:
                logger.warning(
                    f"Failed to process image on page {page.number + 1}: {e}"
                )

    elements.sort(key=lambda x: x[0])
    content = "\n\n".join(elem[1] for elem in elements)
    return content, vision_used


async def extract_text_from_pdf_bytes(
    pdf_bytes: bytes,
    filename: str = "document.pdf",
    *,
    vision_client: VisionClient | None = None,
    process_images: bool = True,
    ocr_scanned_pages: bool = True,
) -> tuple[str, bool]:
    """Extract text from PDF bytes.

    Args:
        pdf_bytes: Raw PDF bytes.
        filename: Filename for logging.
        vision_client: Optional VisionClient for OCR/image description.
        process_images: Whether to extract and describe embedded images.
        ocr_scanned_pages: Whether to OCR pages with low text content.

    Returns:
        Tuple of (extracted_text, vision_was_used).
    """
    logger.info(f"Processing PDF: {filename}")

    max_concurrent = vision_client.max_concurrent_pages if vision_client else 3
    semaphore = asyncio.Semaphore(max_concurrent)

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    total_pages = len(doc)

    async def process_page(page_num: int) -> tuple[int, str, bool]:
        page = doc[page_num]
        content, vis_used = await _extract_page_with_layout(
            page, doc, semaphore, vision_client, process_images, ocr_scanned_pages
        )
        return page_num, f"--- Page {page_num + 1} ---\n{content}", vis_used

    tasks = [process_page(i) for i in range(total_pages)]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    pages_content: list[tuple[int, str]] = []
    vision_used = False

    for result in results:
        if isinstance(result, Exception):
            logger.warning(f"Page processing failed: {result}")
            continue
        page_num, content, page_vision_used = result
        pages_content.append((page_num, content))
        if page_vision_used:
            vision_used = True

    doc.close()

    pages_content.sort(key=lambda x: x[0])
    combined_text = "\n\n".join(p[1] for p in pages_content)

    logger.info(
        f"PDF processing complete: {total_pages} pages, {len(combined_text)} chars, "
        f"Vision API used: {vision_used}"
    )

    return combined_text, vision_used

"""Smart PDF text extraction with selective Vision API usage.

Hybrid approach:
1. Digital PDFs: Extract text directly using PyMuPDF (no API calls)
2. Scanned PDFs: Detect low-text pages and send to Vision API for OCR
3. Embedded images: Extract and describe using Vision API
"""

from __future__ import annotations

import asyncio
from functools import partial
from typing import TYPE_CHECKING

import fitz  # PyMuPDF
from loguru import logger

from ._helpers import MIN_IMAGE_SIZE

if TYPE_CHECKING:
    from tale_knowledge.vision.client import VisionClient

MIN_TEXT_THRESHOLD = 50
MAX_PAGES = 2000
DEFAULT_PAGE_CONCURRENCY = 8


def _extract_page_text_sync(page_bytes: bytes) -> dict:
    """Extract text and image blocks from a single page (runs in thread pool).

    Accepts serialised page bytes to avoid sharing fitz objects across threads.
    Returns a dict with text elements, image blocks, and total_text_len.
    """
    doc = fitz.open(stream=page_bytes, filetype="pdf")
    try:
        page = doc[0]
        text_dict = page.get_text("dict")
        elements: list[tuple[float, str]] = []
        images: list[tuple[float, bytes]] = []
        total_text_len = 0

        for block in text_dict.get("blocks", []):
            block_type = block.get("type")
            y0 = block.get("bbox", [0, 0, 0, 0])[1]

            if block_type == 0:
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
            elif block_type == 1:
                width = block.get("width", 0)
                height = block.get("height", 0)
                image_bytes = block.get("image", b"")
                if width * height >= MIN_IMAGE_SIZE and image_bytes:
                    images.append((y0, bytes(image_bytes)))

        return {
            "elements": elements,
            "images": images,
            "total_text_len": total_text_len,
        }
    finally:
        doc.close()


def _render_page_to_png_sync(page_bytes: bytes, dpi: int) -> bytes:
    """Render a page to PNG bytes (runs in thread pool)."""
    doc = fitz.open(stream=page_bytes, filetype="pdf")
    try:
        page = doc[0]
        mat = fitz.Matrix(dpi / 72, dpi / 72)
        pixmap = page.get_pixmap(matrix=mat)
        png_bytes = pixmap.tobytes("png")
        pixmap = None
        return png_bytes
    finally:
        doc.close()


def _serialize_page(doc: fitz.Document, page_num: int) -> bytes:
    """Serialize a single page to its own PDF bytes for thread-safe processing."""
    single = fitz.open()
    try:
        single.insert_pdf(doc, from_page=page_num, to_page=page_num)
        return single.tobytes()
    finally:
        single.close()


async def _extract_page_with_layout(
    page_bytes: bytes,
    page_num: int,
    vision_semaphore: asyncio.Semaphore,
    vision_client: VisionClient | None,
    process_images: bool,
    ocr_scanned_pages: bool,
) -> tuple[str, bool]:
    """Extract page content preserving text and image positions."""
    loop = asyncio.get_running_loop()

    text_data = await loop.run_in_executor(
        None, partial(_extract_page_text_sync, page_bytes)
    )
    elements: list[tuple[float, str]] = text_data["elements"]
    images: list[tuple[float, bytes]] = text_data["images"]
    total_text_len: int = text_data["total_text_len"]
    vision_used = False

    if total_text_len < MIN_TEXT_THRESHOLD and ocr_scanned_pages and vision_client:
        logger.debug(
            f"Page {page_num + 1}: Low text ({total_text_len} chars), sending to Vision API for OCR"
        )
        async with vision_semaphore:
            try:
                dpi = vision_client.pdf_dpi
                ocr_png = await loop.run_in_executor(
                    None, partial(_render_page_to_png_sync, page_bytes, dpi)
                )
                ocr_text = await vision_client.ocr_image(ocr_png)
                if ocr_text:
                    elements = [(0, ocr_text)]
                    vision_used = True
            except Exception as e:
                logger.warning(f"Failed to OCR page {page_num + 1}: {e}")

    if process_images and vision_client and images:
        for y0, img_bytes in images:
            try:
                async with vision_semaphore:
                    description = await vision_client.describe_image(img_bytes)
                if description:
                    elements.append((y0, f"[Image: {description}]"))
                    vision_used = True
            except Exception as e:
                logger.warning(f"Failed to describe image on page {page_num + 1}: {e}")

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
    max_pages: int = MAX_PAGES,
) -> tuple[str, bool]:
    """Extract text from PDF bytes.

    Args:
        pdf_bytes: Raw PDF bytes.
        filename: Filename for logging.
        vision_client: Optional VisionClient for OCR/image description.
        process_images: Whether to extract and describe embedded images.
        ocr_scanned_pages: Whether to OCR pages with low text content.
        max_pages: Maximum number of pages to process.

    Returns:
        Tuple of (extracted_text, vision_was_used).
    """
    logger.info(f"Processing PDF: {filename}")

    max_concurrent_vision = vision_client.max_concurrent_pages if vision_client else 3
    vision_semaphore = asyncio.Semaphore(max_concurrent_vision)
    page_semaphore = asyncio.Semaphore(DEFAULT_PAGE_CONCURRENCY)

    loop = asyncio.get_running_loop()

    doc = await loop.run_in_executor(
        None, partial(fitz.open, stream=pdf_bytes, filetype="pdf")
    )
    try:
        total_pages = len(doc)
        pages_to_process = min(total_pages, max_pages)

        if total_pages > max_pages:
            logger.warning(
                f"PDF has {total_pages} pages, exceeding limit of {max_pages}. "
                f"Only the first {max_pages} pages will be processed."
            )

        page_data: list[tuple[int, bytes]] = []
        for i in range(pages_to_process):
            page_bytes = await loop.run_in_executor(
                None, partial(_serialize_page, doc, i)
            )
            page_data.append((i, page_bytes))
    finally:
        doc.close()

    async def process_page(page_num: int, page_bytes: bytes) -> tuple[int, str, bool]:
        async with page_semaphore:
            content, vis_used = await _extract_page_with_layout(
                page_bytes,
                page_num,
                vision_semaphore,
                vision_client,
                process_images,
                ocr_scanned_pages,
            )
            return page_num, f"--- Page {page_num + 1} ---\n{content}", vis_used

    tasks = [process_page(pn, pb) for pn, pb in page_data]
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

    pages_content.sort(key=lambda x: x[0])
    combined_text = "\n\n".join(p[1] for p in pages_content)

    logger.info(
        f"PDF processing complete: {pages_to_process} pages, {len(combined_text)} chars, "
        f"Vision API used: {vision_used}"
    )

    return combined_text, vision_used

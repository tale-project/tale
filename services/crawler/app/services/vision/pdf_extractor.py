"""Smart PDF text extraction with Vision API support.

This module implements a hybrid approach for PDF processing:
1. Digital PDFs: Extract text directly using PyMuPDF
2. Scanned PDFs: Detect low-text pages and send to Vision API for OCR
3. Embedded images: Extract and describe using Vision API
4. Position preservation: Maintain relative positions of text and images
"""

import asyncio

import fitz  # PyMuPDF
from loguru import logger

from ...config import settings
from .openai_client import vision_client

MIN_TEXT_THRESHOLD = 50
MIN_IMAGE_SIZE = 10000  # ~100x100 pixels


async def _describe_image(
    doc: fitz.Document,
    xref: int,
    semaphore: asyncio.Semaphore,
) -> str:
    """Extract and describe an image from a PDF document."""
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


async def _ocr_page(
    page: fitz.Page,
    semaphore: asyncio.Semaphore,
) -> str:
    """Render a page as image and OCR it using Vision API."""
    async with semaphore:
        try:
            dpi = settings.vision_pdf_dpi
            mat = fitz.Matrix(dpi / 72, dpi / 72)
            pixmap = page.get_pixmap(matrix=mat)
            image_bytes = pixmap.tobytes("png")
            return await vision_client.ocr_image(image_bytes)
        except Exception as e:
            logger.warning(f"Failed to OCR page, returning empty text: {e}")
            return ""


async def _extract_page_with_layout(
    page: fitz.Page,
    doc: fitz.Document,
    semaphore: asyncio.Semaphore,
    process_images: bool,
    ocr_scanned_pages: bool,
) -> tuple[str, bool]:
    """Extract page content preserving text and image positions.

    Args:
        page: PyMuPDF page object
        doc: PyMuPDF document object
        semaphore: Concurrency limiter
        process_images: Whether to extract and describe images
        ocr_scanned_pages: Whether to OCR pages with low text content

    Returns:
        Tuple of (page_content, vision_used)
    """
    elements: list[tuple[float, str]] = []  # (y_coord, content)
    vision_used = False

    # Get text blocks with positions
    text_dict = page.get_text("dict")
    total_text_len = 0

    for block in text_dict.get("blocks", []):
        if block.get("type") == 0:  # text block
            y0 = block.get("bbox", [0, 0, 0, 0])[1]
            lines_text = []
            for line in block.get("lines", []):
                spans_text = "".join(span.get("text", "") for span in line.get("spans", []))
                lines_text.append(spans_text)
            text = "\n".join(lines_text).strip()
            if text:
                elements.append((y0, text))
                total_text_len += len(text)

    # Check if this is a scanned page (low text content)
    if total_text_len < MIN_TEXT_THRESHOLD and ocr_scanned_pages:
        logger.debug(
            f"Page {page.number + 1}: Low text ({total_text_len} chars), sending to Vision API for OCR"
        )
        ocr_text = await _ocr_page(page, semaphore)
        if ocr_text:
            elements = [(0, ocr_text)]
            vision_used = True

    # Extract and describe embedded images
    if process_images:
        image_list = page.get_images(full=True)
        for img_info in image_list:
            xref = img_info[0]
            try:
                bbox_list = page.get_image_rects(xref)
                if bbox_list:
                    bbox = bbox_list[0]
                    y0 = bbox.y0
                else:
                    y0 = float("inf")

                description = await _describe_image(doc, xref, semaphore)
                if description:
                    elements.append((y0, f"[Image: {description}]"))
                    vision_used = True
            except Exception as e:
                logger.warning(f"Failed to process image on page {page.number + 1}: {e}")
                continue

    # Sort by y coordinate to maintain top-to-bottom reading order
    elements.sort(key=lambda x: x[0])
    content = "\n\n".join(elem[1] for elem in elements)

    return content, vision_used


async def extract_text_from_pdf_bytes(
    pdf_bytes: bytes,
    filename: str = "document.pdf",
    *,
    process_images: bool = True,
    ocr_scanned_pages: bool = True,
) -> tuple[list[str], bool]:
    """Extract text from PDF bytes with Vision support.

    Args:
        pdf_bytes: Raw PDF bytes
        filename: Optional filename for logging
        process_images: Whether to extract and describe embedded images
        ocr_scanned_pages: Whether to OCR pages with low text content

    Returns:
        Tuple of (list of page contents, vision_used flag)
    """
    logger.info(f"Processing PDF: {filename}")

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    total_pages = len(doc)
    semaphore = asyncio.Semaphore(settings.vision_max_concurrent_pages)

    async def process_page(page_num: int) -> tuple[int, str, bool]:
        page = doc[page_num]
        content, vision_used = await _extract_page_with_layout(
            page, doc, semaphore, process_images, ocr_scanned_pages
        )
        return page_num, f"--- Page {page_num + 1} ---\n{content}", vision_used

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

    # Sort by page number
    pages_content.sort(key=lambda x: x[0])
    ordered_content = [p[1] for p in pages_content]

    logger.info(
        f"PDF processing complete: {total_pages} pages, Vision API used: {vision_used}"
    )

    return ordered_content, vision_used

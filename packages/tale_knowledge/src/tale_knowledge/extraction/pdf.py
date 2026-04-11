"""Smart PDF text extraction with selective Vision API usage.

Hybrid approach:
1. Digital PDFs: Extract text directly using PyMuPDF (no API calls)
2. Embedded images: Large images (>50% page area) are OCR'd, smaller ones described

Scanned page detection:
- Pages with < SCANNED_PAGE_TEXT_THRESHOLD characters of digital text are
  considered "scanned" when they also contain at least one embedded image
  covering > LARGE_IMAGE_RATIO of the page area.
- The extraction result includes `scanned_pages_detected` and `ocr_applied`
  so callers can inform the user about OCR activity.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import dataclass
from functools import partial
from typing import TYPE_CHECKING

import fitz  # PyMuPDF
from loguru import logger

from ._helpers import MIN_IMAGE_SIZE

if TYPE_CHECKING:
    from tale_knowledge.vision.client import VisionClient

ProgressCallback = Callable[[int, int], None]  # (pages_done, total_pages)

LARGE_IMAGE_RATIO = 0.5
SCANNED_PAGE_TEXT_THRESHOLD = 50
MAX_PAGES = 2000
DEFAULT_PAGE_CONCURRENCY = 8


@dataclass(frozen=True, slots=True)
class PdfExtractionResult:
    """Result of a PDF text extraction."""

    text: str
    vision_used: bool
    scanned_pages_detected: int
    ocr_applied: bool


def _extract_page_text_sync(page_bytes: bytes) -> dict:
    """Extract text and image blocks from a single page (runs in thread pool).

    Accepts serialised page bytes to avoid sharing fitz objects across threads.
    Returns a dict with text elements, image blocks (with area ratio), and total_text_len.
    """
    doc = fitz.open(stream=page_bytes, filetype="pdf")
    try:
        page = doc[0]
        page_rect = page.rect
        page_area = page_rect.get_area()
        text_dict = page.get_text("dict")
        elements: list[tuple[float, str]] = []
        images: list[tuple[float, bytes, float]] = []
        total_text_len = 0

        for block in text_dict.get("blocks", []):
            block_type = block.get("type")
            bbox = block.get("bbox", [0, 0, 0, 0])
            y0 = bbox[1]

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
                    visible_rect = fitz.Rect(bbox) & page_rect
                    area_ratio = (
                        visible_rect.get_area() / page_area if page_area > 0 else 0
                    )
                    images.append((y0, bytes(image_bytes), area_ratio))

        return {
            "elements": elements,
            "images": images,
            "total_text_len": total_text_len,
        }
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
) -> tuple[str, bool, bool]:
    """Extract page content preserving text and image positions.

    Images covering >50% of the page area are OCR'd (likely scanned pages),
    smaller images are described.

    Returns:
        Tuple of (content, vision_used, is_scanned_page).
    """
    loop = asyncio.get_running_loop()

    text_data = await loop.run_in_executor(
        None, partial(_extract_page_text_sync, page_bytes)
    )
    elements: list[tuple[float, str]] = text_data["elements"]
    images: list[tuple[float, bytes, float]] = text_data["images"]
    total_text_len: int = text_data["total_text_len"]
    vision_used = False

    has_large_image = any(area_ratio > LARGE_IMAGE_RATIO for _, _, area_ratio in images)
    is_scanned_page = total_text_len < SCANNED_PAGE_TEXT_THRESHOLD and has_large_image

    if is_scanned_page and not vision_client:
        logger.warning(
            f"Page {page_num + 1}: Scanned page detected ({total_text_len} chars, "
            f"large image present) but no vision client configured — OCR skipped"
        )

    if process_images and vision_client and images:
        for y0, img_bytes, area_ratio in images:
            try:
                async with vision_semaphore:
                    if area_ratio > LARGE_IMAGE_RATIO:
                        logger.debug(
                            f"Page {page_num + 1}: Large image ({area_ratio:.0%} of page), using OCR"
                        )
                        text = await vision_client.ocr_image(img_bytes)
                        if text:
                            elements.append((y0, text))
                            vision_used = True
                    else:
                        description = await vision_client.describe_image(img_bytes)
                        if description:
                            elements.append((y0, f"[Image: {description}]"))
                            vision_used = True
            except Exception as e:
                logger.warning(f"Failed to process image on page {page_num + 1}: {e}")

    elements.sort(key=lambda x: x[0])
    content = "\n\n".join(elem[1] for elem in elements)
    return content, vision_used, is_scanned_page


async def extract_text_from_pdf_bytes(
    pdf_bytes: bytes,
    filename: str = "document.pdf",
    *,
    vision_client: VisionClient | None = None,
    process_images: bool = True,
    max_pages: int = MAX_PAGES,
    on_progress: ProgressCallback | None = None,
) -> PdfExtractionResult:
    """Extract text from PDF bytes.

    Args:
        pdf_bytes: Raw PDF bytes.
        filename: Filename for logging.
        vision_client: Optional VisionClient for OCR/image description.
        process_images: Whether to extract and describe embedded images.
        max_pages: Maximum number of pages to process.
        on_progress: Optional callback ``(pages_done, total_pages)`` invoked
            after each page completes.  Safe to call from concurrent tasks.

    Returns:
        PdfExtractionResult with text, vision_used, scanned_pages_detected, and ocr_applied.
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

    pages_done = 0

    async def process_page(
        page_num: int, page_bytes: bytes
    ) -> tuple[int, str, bool, bool]:
        nonlocal pages_done
        async with page_semaphore:
            content, vis_used, is_scanned = await _extract_page_with_layout(
                page_bytes,
                page_num,
                vision_semaphore,
                vision_client,
                process_images,
            )
            pages_done += 1
            if on_progress is not None:
                on_progress(pages_done, pages_to_process)
            return (
                page_num,
                f"--- Page {page_num + 1} ---\n{content}",
                vis_used,
                is_scanned,
            )

    tasks = [process_page(pn, pb) for pn, pb in page_data]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    pages_content: list[tuple[int, str]] = []
    vision_used = False
    scanned_pages_detected = 0
    ocr_applied = False

    for result in results:
        if isinstance(result, Exception):
            logger.warning(f"Page processing failed: {result}")
            continue
        page_num, content, page_vision_used, page_is_scanned = result
        pages_content.append((page_num, content))
        if page_vision_used:
            vision_used = True
        if page_is_scanned:
            scanned_pages_detected += 1
            if page_vision_used:
                ocr_applied = True

    pages_content.sort(key=lambda x: x[0])
    combined_text = "\n\n".join(p[1] for p in pages_content)

    if scanned_pages_detected > 0 and not vision_client:
        logger.warning(
            f"PDF '{filename}': {scanned_pages_detected} scanned page(s) detected "
            f"but no vision client configured — text may be incomplete"
        )

    logger.info(
        f"PDF processing complete: {pages_to_process} pages, {len(combined_text)} chars, "
        f"Vision API used: {vision_used}, scanned pages: {scanned_pages_detected}, "
        f"OCR applied: {ocr_applied}"
    )

    return PdfExtractionResult(
        text=combined_text,
        vision_used=vision_used,
        scanned_pages_detected=scanned_pages_detected,
        ocr_applied=ocr_applied,
    )

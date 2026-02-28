"""Smart DOCX text extraction with Vision API support.

Extracts text and images from DOCX files while preserving the relative
positions of text and images in the document.
"""

from __future__ import annotations

import asyncio
from io import BytesIO
from typing import TYPE_CHECKING

from docx import Document
from docx.opc.constants import RELATIONSHIP_TYPE as RT
from loguru import logger

if TYPE_CHECKING:
    from tale_knowledge.vision.client import VisionClient

MIN_IMAGE_SIZE = 10000  # ~100x100 pixels


async def _describe_image_bytes(
    image_bytes: bytes,
    semaphore: asyncio.Semaphore,
    vision_client: VisionClient,
) -> str:
    async with semaphore:
        try:
            if len(image_bytes) < MIN_IMAGE_SIZE:
                logger.debug(f"Skipping small image ({len(image_bytes)} bytes)")
                return ""
            return await vision_client.describe_image(image_bytes)
        except Exception as e:
            logger.warning(f"Failed to describe image: {e}")
            return ""


def _extract_table_text(table) -> str:
    rows_text = []
    for row in table.rows:
        cells_text = [cell.text.strip() for cell in row.cells]
        rows_text.append(" | ".join(cells_text))
    return "\n".join(rows_text)


async def extract_text_from_docx_bytes(
    docx_bytes: bytes,
    filename: str = "document.docx",
    *,
    vision_client: VisionClient | None = None,
    process_images: bool = True,
    max_concurrent: int = 3,
) -> tuple[str, bool]:
    """Extract text from DOCX bytes with optional Vision support.

    Args:
        docx_bytes: Raw DOCX bytes.
        filename: Filename for logging.
        vision_client: Optional VisionClient for image description.
        process_images: Whether to extract and describe embedded images.
        max_concurrent: Max concurrent Vision API calls.

    Returns:
        Tuple of (extracted_text, vision_was_used).
    """
    logger.info(f"Processing DOCX: {filename}")

    doc = Document(BytesIO(docx_bytes))
    elements: list[tuple[int, str]] = []
    vision_used = False
    position = 0
    semaphore = asyncio.Semaphore(max_concurrent)

    image_rels: dict[str, bytes] = {}
    if process_images and vision_client:
        for rel in doc.part.rels.values():
            if rel.reltype == RT.IMAGE:
                try:
                    image_rels[rel.rId] = rel.target_part.blob
                except Exception as e:
                    logger.warning(f"Failed to extract image rel {rel.rId}: {e}")

    processed_image_rids: set[str] = set()

    for element in doc.element.body:
        tag = element.tag.split("}")[-1] if "}" in element.tag else element.tag

        if tag == "p":
            para = None
            for p in doc.paragraphs:
                if p._element == element:
                    para = p
                    break

            if para:
                text = para.text.strip()
                if text:
                    elements.append((position, text))
                    position += 1

                if process_images and vision_client:
                    blip_ns = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
                    embed_ns = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

                    for blip in element.iter(f"{blip_ns}blip"):
                        embed_id = blip.get(f"{embed_ns}embed")
                        if (
                            embed_id
                            and embed_id in image_rels
                            and embed_id not in processed_image_rids
                        ):
                            processed_image_rids.add(embed_id)
                            image_bytes = image_rels[embed_id]
                            description = await _describe_image_bytes(
                                image_bytes, semaphore, vision_client
                            )
                            if description:
                                elements.append((position, f"[Image: {description}]"))
                                vision_used = True
                                position += 1

        elif tag == "tbl":
            for table in doc.tables:
                if table._element == element:
                    table_text = _extract_table_text(table)
                    if table_text:
                        elements.append((position, f"[Table]\n{table_text}"))
                        position += 1
                    break

    if process_images and vision_client:
        for rid, image_bytes in image_rels.items():
            if rid not in processed_image_rids:
                description = await _describe_image_bytes(
                    image_bytes, semaphore, vision_client
                )
                if description:
                    elements.append((position, f"[Image: {description}]"))
                    vision_used = True
                    position += 1

    elements.sort(key=lambda x: x[0])
    content = "\n\n".join(elem[1] for elem in elements)

    logger.info(
        f"DOCX processing complete: {len(elements)} elements, Vision API used: {vision_used}"
    )

    return content, vision_used

"""Shared helper functions for extraction modules."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

from loguru import logger

if TYPE_CHECKING:
    from tale_knowledge.vision.client import VisionClient

MIN_IMAGE_SIZE = 10000  # ~100x100 pixels


async def describe_image_bytes(
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


def extract_table_text(table) -> str:
    rows_text = []
    for row in table.rows:
        cells_text = [cell.text.strip() for cell in row.cells]
        rows_text.append(" | ".join(cells_text))
    return "\n".join(rows_text)

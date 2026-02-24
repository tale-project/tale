"""Web page image extraction and description.

Downloads and describes significant images found on web pages using the Vision API.
Filters out icons, tracking pixels, and decorative images.
"""

import asyncio
from urllib.parse import urljoin, urlparse

import httpx
from loguru import logger

from .vision.openai_client import vision_client

MAX_IMAGES_TO_PROCESS = 10
MIN_IMAGE_BYTES = 10_000  # ~10KB, skip tiny images
MAX_IMAGE_DOWNLOAD_BYTES = 10 * 1024 * 1024  # 10 MB per image
IMAGE_DOWNLOAD_TIMEOUT = 15.0  # seconds per image download
SKIP_EXTENSIONS = {".svg", ".ico", ".gif"}

_HTTP_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; TaleCrawler/1.0)",
    "Accept": "image/*",
}


def _filter_image_candidates(
    media_images: list[dict],
    page_url: str,
) -> list[str]:
    """Filter and deduplicate image URLs from Crawl4AI media results.

    Selection criteria:
    - Skip data: URIs (base64-encoded tiny images / tracking pixels)
    - Skip known non-content extensions (.svg, .ico, .gif)
    - Prefer higher-scored images (Crawl4AI relevance score)
    - Deduplicate by resolved absolute URL
    - Cap at MAX_IMAGES_TO_PROCESS

    Args:
        media_images: List of image dicts from CrawlResult.media["images"]
        page_url: The page URL for resolving relative URLs

    Returns:
        List of unique absolute image URLs, ordered by relevance score descending
    """
    scored: list[tuple[float, str]] = []
    seen: set[str] = set()

    for img in media_images:
        src = img.get("src", "")
        if not src or src.startswith("data:"):
            continue

        absolute_url = urljoin(page_url, src)

        path = urlparse(absolute_url).path.lower()
        ext = ""
        if "." in path.split("/")[-1]:
            ext = "." + path.rsplit(".", 1)[-1]
        if ext in SKIP_EXTENSIONS:
            continue

        if absolute_url in seen:
            continue
        seen.add(absolute_url)

        score = img.get("score", 0.0)
        scored.append((score, absolute_url))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [url for _, url in scored[:MAX_IMAGES_TO_PROCESS]]


async def _download_image(
    url: str,
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
) -> bytes | None:
    """Download a single image, respecting size limits.

    Returns None if download fails or image is too small.
    """
    async with semaphore:
        try:
            response = await client.get(url, timeout=IMAGE_DOWNLOAD_TIMEOUT)
            response.raise_for_status()

            image_bytes = response.content
            if len(image_bytes) < MIN_IMAGE_BYTES:
                logger.debug(f"Skipping small image ({len(image_bytes)} bytes): {url}")
                return None

            if len(image_bytes) > MAX_IMAGE_DOWNLOAD_BYTES:
                logger.debug(f"Skipping oversized image ({len(image_bytes)} bytes): {url}")
                return None

            return image_bytes
        except Exception as e:
            logger.debug(f"Failed to download image {url}: {e}")
            return None


async def extract_and_describe_images(
    media_images: list[dict],
    page_url: str,
    max_concurrent: int = 3,
) -> tuple[list[str], bool]:
    """Download significant images from a web page and describe them using Vision API.

    Args:
        media_images: Image metadata from CrawlResult.media["images"]
        page_url: The page URL for resolving relative URLs
        max_concurrent: Max concurrent downloads/API calls

    Returns:
        Tuple of (list of "[Image: description]" strings, vision_used flag)
    """
    candidates = _filter_image_candidates(media_images, page_url)
    if not candidates:
        return [], False

    logger.info(f"Processing {len(candidates)} images from {page_url}")

    semaphore = asyncio.Semaphore(max_concurrent)
    descriptions: list[str] = []
    vision_used = False

    async with httpx.AsyncClient(headers=_HTTP_HEADERS, follow_redirects=True) as client:
        download_tasks = [_download_image(url, client, semaphore) for url in candidates]
        downloaded = await asyncio.gather(*download_tasks)

        describe_tasks = []
        for image_bytes in downloaded:
            if image_bytes is not None:
                describe_tasks.append(vision_client.describe_image(image_bytes))

        if describe_tasks:
            results = await asyncio.gather(*describe_tasks, return_exceptions=True)
            for result in results:
                if isinstance(result, Exception):
                    logger.warning(f"Failed to describe image: {result}")
                    continue
                if result:
                    descriptions.append(f"[Image: {result}]")
                    vision_used = True

    logger.info(f"Described {len(descriptions)} images, vision_used={vision_used}")
    return descriptions, vision_used

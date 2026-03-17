"""
Shared HTTP file download utility.

Provides streaming file downloads with size limits, used by web and PDF routers.
"""

import httpx
from fastapi import HTTPException, status
from loguru import logger

MAX_FILE_DOWNLOAD_BYTES = 100 * 1024 * 1024  # 100 MB
HTTP_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; TaleCrawler/1.0)",
    "Accept": "*/*",
}


async def download_file(url: str, timeout: float) -> tuple[bytes, str]:
    """
    Download file bytes from a URL using streaming.

    Returns:
        Tuple of (file_bytes, content_type).

    Raises:
        HTTPException: If file exceeds max size or download fails.
    """
    async with (
        httpx.AsyncClient(follow_redirects=True, timeout=timeout, headers=HTTP_HEADERS) as client,
        client.stream("GET", url) as response,
    ):
        response.raise_for_status()
        content_type = response.headers.get("content-type", "")
        content_length = response.headers.get("content-length")

        if content_length and int(content_length) > MAX_FILE_DOWNLOAD_BYTES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File too large ({int(content_length)} bytes). Maximum: {MAX_FILE_DOWNLOAD_BYTES} bytes.",
            )

        chunks = []
        total = 0
        async for chunk in response.aiter_bytes():
            total += len(chunk)
            if total > MAX_FILE_DOWNLOAD_BYTES:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"File too large (>{MAX_FILE_DOWNLOAD_BYTES} bytes). Download aborted.",
                )
            chunks.append(chunk)

        logger.debug(f"Downloaded {total} bytes from {url}")
        return b"".join(chunks), content_type

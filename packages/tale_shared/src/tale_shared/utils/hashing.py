"""SHA-256 hashing utilities for content deduplication."""

import hashlib
from pathlib import Path

import aiofiles


async def compute_file_hash(file_path: str | Path) -> str:
    """Compute SHA-256 hash of a file's content.

    Args:
        file_path: Path to the file.

    Returns:
        Hex-encoded SHA-256 hash string.
    """
    sha256 = hashlib.sha256()
    async with aiofiles.open(file_path, "rb") as f:
        while chunk := await f.read(8192):
            sha256.update(chunk)
    return sha256.hexdigest()


def compute_content_hash(content: bytes) -> str:
    """Compute SHA-256 hash of in-memory bytes.

    Args:
        content: Raw bytes to hash.

    Returns:
        Hex-encoded SHA-256 hash string.
    """
    return hashlib.sha256(content).hexdigest()

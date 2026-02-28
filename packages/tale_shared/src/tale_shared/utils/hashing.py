"""SHA-256 hashing utilities for content deduplication."""

import hashlib
from pathlib import Path


def compute_file_hash(file_path: str | Path) -> str:
    """Compute SHA-256 hash of a file's content.

    Args:
        file_path: Path to the file.

    Returns:
        Hex-encoded SHA-256 hash string.
    """
    sha256 = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(8192):
            sha256.update(chunk)
    return sha256.hexdigest()


def compute_content_hash(content: str | bytes) -> str:
    """Compute SHA-256 hash of in-memory content.

    Args:
        content: String or bytes to hash. Strings are encoded as UTF-8.

    Returns:
        Hex-encoded SHA-256 hash string.
    """
    if isinstance(content, str):
        content = content.encode("utf-8")
    return hashlib.sha256(content).hexdigest()

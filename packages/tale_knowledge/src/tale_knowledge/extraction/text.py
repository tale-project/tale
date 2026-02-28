"""Plain text, markdown, and CSV extraction.

Simple UTF-8 text reading — no Vision API needed.
"""

from loguru import logger

SUPPORTED_TEXT_EXTENSIONS = {
    ".txt",
    ".md",
    ".csv",
    ".json",
    ".xml",
    ".html",
    ".htm",
    ".log",
}


async def extract_text_from_text_bytes(
    text_bytes: bytes,
    filename: str = "document.txt",
) -> tuple[str, bool]:
    """Extract text from plain text bytes.

    Args:
        text_bytes: Raw file bytes.
        filename: Filename for logging.

    Returns:
        Tuple of (extracted_text, vision_was_used). Vision is never used.

    Raises:
        UnicodeDecodeError: If the content cannot be decoded as UTF-8.
    """
    logger.info(f"Processing text file: {filename}")
    text = text_bytes.decode("utf-8")
    return text, False

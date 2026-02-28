"""Plain text, markdown, and CSV extraction.

Simple UTF-8 text reading — no Vision API needed.
"""

from loguru import logger

SUPPORTED_TEXT_EXTENSIONS = {
    # Text / markup
    ".txt",
    ".md",
    ".mdx",
    ".rst",
    ".tex",
    ".csv",
    ".tsv",
    ".html",
    ".htm",
    ".css",
    ".scss",
    ".sass",
    ".less",
    ".log",
    # Data / config
    ".json",
    ".yaml",
    ".yml",
    ".toml",
    ".xml",
    ".ini",
    ".cfg",
    ".conf",
    ".properties",
    # Code
    ".py",
    ".pyi",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".mjs",
    ".cjs",
    ".c",
    ".h",
    ".cpp",
    ".hpp",
    ".cc",
    ".cxx",
    ".rs",
    ".go",
    ".swift",
    ".kt",
    ".java",
    ".rb",
    ".php",
    ".pl",
    ".lua",
    ".r",
    ".scala",
    ".groovy",
    ".dart",
    ".ex",
    ".exs",
    # Shell / scripts
    ".sh",
    ".bash",
    ".zsh",
    ".ps1",
    ".bat",
    ".cmd",
    # Query / schema
    ".sql",
    ".graphql",
    ".gql",
    ".proto",
    # Build / project
    ".gradle",
    ".cmake",
    ".lock",
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
    """
    logger.info(f"Processing text file: {filename}")
    try:
        text = text_bytes.decode("utf-8")
    except UnicodeDecodeError:
        text = text_bytes.decode("latin-1")
        logger.warning("File {} is not UTF-8, fell back to Latin-1", filename)
    return text, False

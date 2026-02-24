"""Content type detection utilities for URL and HTTP header analysis."""

from urllib.parse import urlparse

DOCUMENT_CONTENT_TYPES = {
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "application/msword": ".doc",
    "application/vnd.ms-powerpoint": ".pptx",
}

IMAGE_CONTENT_TYPES = {
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/bmp",
    "image/tiff",
    "image/svg+xml",
}

DOCUMENT_EXTENSIONS = {".pdf", ".docx", ".pptx"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".tif", ".svg"}


def detect_type_from_url(url_str: str) -> tuple[str | None, str]:
    """Check URL path extension to detect known file types.

    Returns:
        Tuple of (extension_or_None, category). Category is "document", "image", or "unknown".
    """
    parsed = urlparse(url_str)
    path = parsed.path.lower().split("?")[0]
    for ext in DOCUMENT_EXTENSIONS:
        if path.endswith(ext):
            return ext, "document"
    for ext in IMAGE_EXTENSIONS:
        if path.endswith(ext):
            return ext, "image"
    return None, "unknown"


def detect_type_from_content_type(content_type: str) -> tuple[str | None, str]:
    """Map Content-Type header to a file extension and category.

    Returns:
        Tuple of (extension_or_None, category). Category is "document", "image", or "unknown".
    """
    ct = content_type.lower().split(";")[0].strip()
    doc_ext = DOCUMENT_CONTENT_TYPES.get(ct)
    if doc_ext:
        return doc_ext, "document"
    if ct in IMAGE_CONTENT_TYPES:
        return "." + ct.split("/")[1].split("+")[0], "image"
    return None, "unknown"

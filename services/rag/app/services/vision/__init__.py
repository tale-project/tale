"""Vision module for document text extraction using OpenAI Vision API.

This module provides intelligent document processing by:
1. Using PyMuPDF for direct text extraction from digital PDFs
2. Selectively using Vision API for OCR on scanned pages
3. Extracting and describing embedded images
4. Passing through DOCX/PPTX/XLSX to Cognee's native handlers

This hybrid approach minimizes API costs while handling all document types.
Vision API results are cached based on image content hash to avoid redundant calls.
"""

from .cache import vision_cache
from .processor import (
    extract_text_from_bytes,
    extract_text_from_document,
    is_passthrough_type,
    is_vision_supported,
)

__all__ = [
    "extract_text_from_bytes",
    "extract_text_from_document",
    "is_passthrough_type",
    "is_vision_supported",
    "vision_cache",
]

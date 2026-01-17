"""
Service layer for the Tale Crawler application.

This package contains business logic services:
- base_converter: Shared Playwright infrastructure for document conversion
- pdf_service: PDF generation from HTML/Markdown/URL
- image_service: Image generation from HTML/Markdown/URL
- crawler_service: Web crawling and URL discovery
- docx_service: DOCX document generation
- file_parser_service: File parsing and text extraction
- pptx_service: PPTX template analysis and generation
- template_service: Facade for PPTX/DOCX generation
"""

from app.services.base_converter import BaseConverterService
from app.services.crawler_service import CrawlerService, get_crawler_service
from app.services.docx_service import DocxService, get_docx_service
from app.services.file_parser_service import FileParserService
from app.services.image_service import ImageService, get_image_service
from app.services.pdf_service import PdfService, get_pdf_service
from app.services.pptx_service import PptxService, get_pptx_service
from app.services.template_service import TemplateService, get_template_service

__all__ = [
    "BaseConverterService",
    "CrawlerService",
    "DocxService",
    "FileParserService",
    "ImageService",
    "PdfService",
    "PptxService",
    "TemplateService",
    "get_crawler_service",
    "get_docx_service",
    "get_image_service",
    "get_pdf_service",
    "get_pptx_service",
    "get_template_service",
]


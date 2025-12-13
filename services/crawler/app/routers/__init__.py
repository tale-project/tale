"""
API Routers for the Tale Crawler service.

This package contains modular routers following Clean Architecture principles:
- crawler: Web crawling and URL discovery endpoints (/api/v1/urls)
- pdf: PDF conversion and parsing (/api/v1/pdf)
- image: Image conversion (/api/v1/images)
- docx: DOCX document generation and parsing (/api/v1/docx)
- pptx: PPTX template generation and parsing (/api/v1/pptx)
"""

from app.routers.crawler import router as crawler_router
from app.routers.pdf import router as pdf_router
from app.routers.image import router as image_router
from app.routers.docx import router as docx_router
from app.routers.pptx import router as pptx_router

__all__ = [
    "crawler_router",
    "pdf_router",
    "image_router",
    "docx_router",
    "pptx_router",
]

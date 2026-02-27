"""
API Routers for the Tale Crawler service.

This package contains modular routers following Clean Architecture principles:
- crawler: Content fetching and URL check endpoints (/api/v1/urls)
- websites: Website registration and URL listing (/api/v1/websites)
- search: Hybrid full-text + vector search (/api/v1/search)
- pages: List indexed pages per website (/api/v1/pages)
- index: Content indexing management (/api/v1/index)
- pdf: PDF conversion and parsing (/api/v1/pdf)
- image: Image conversion (/api/v1/images)
- docx: DOCX document generation and parsing (/api/v1/docx)
- pptx: PPTX template generation and parsing (/api/v1/pptx)
- web: Web fetch and extract (/api/v1/web)
"""

from app.routers.crawler import router as crawler_router
from app.routers.docx import router as docx_router
from app.routers.image import router as image_router
from app.routers.index import router as index_router
from app.routers.pages import router as pages_router
from app.routers.pdf import router as pdf_router
from app.routers.pptx import router as pptx_router
from app.routers.search import router as search_router
from app.routers.web import router as web_router
from app.routers.websites import router as websites_router

__all__ = [
    "crawler_router",
    "docx_router",
    "image_router",
    "index_router",
    "pages_router",
    "pdf_router",
    "pptx_router",
    "search_router",
    "web_router",
    "websites_router",
]

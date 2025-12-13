"""
Template Service - Facade for PPTX and DOCX generation.

This module provides a unified interface for document generation by delegating
to specialized services:
- PptxService: PowerPoint template analysis and generation
- DocxService: Word document generation

For new code, prefer importing the specialized services directly:
- from app.pptx_service import get_pptx_service
- from app.docx_service import get_docx_service
"""

import logging
from typing import Optional, List, Dict, Any

from app.services.pptx_service import PptxService, get_pptx_service
from app.services.docx_service import DocxService, get_docx_service

logger = logging.getLogger(__name__)


class TemplateService:
    """
    Facade service for analyzing and generating Office documents.

    This class maintains backward compatibility by delegating to
    PptxService and DocxService internally.
    """

    def __init__(self):
        self._pptx_service = PptxService()
        self._docx_service = DocxService()

    async def cleanup(self):
        """Cleanup resources."""
        await self._pptx_service.cleanup()
        await self._docx_service.cleanup()

    async def download_file(self, url: str) -> bytes:
        """Download a file from URL."""
        return await self._pptx_service.download_file(url)

    # =========================================================================
    # PPTX METHODS - Delegated to PptxService
    # =========================================================================

    async def analyze_pptx_template(
        self,
        template_url: Optional[str] = None,
        template_bytes: Optional[bytes] = None,
        template_base64: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Analyze a PPTX template and extract its FULL structure and content.

        Delegated to PptxService.
        """
        return await self._pptx_service.analyze_pptx_template(
            template_url=template_url,
            template_bytes=template_bytes,
            template_base64=template_base64,
        )

    async def generate_pptx_from_content(
        self,
        slides_content: List[Dict[str, Any]],
        branding: Optional[Dict[str, Any]] = None,
        template_bytes: Optional[bytes] = None,
    ) -> bytes:
        """
        Generate a PPTX based on provided content.

        Delegated to PptxService.
        """
        return await self._pptx_service.generate_pptx_from_content(
            slides_content=slides_content,
            branding=branding,
            template_bytes=template_bytes,
        )

    # =========================================================================
    # DOCX METHODS - Delegated to DocxService
    # =========================================================================

    async def generate_docx(
        self,
        content: Dict[str, Any],
    ) -> bytes:
        """
        Generate a DOCX document from structured content.

        Delegated to DocxService.
        """
        return await self._docx_service.generate_docx(content=content)

    async def generate_docx_from_template(
        self,
        content: Dict[str, Any],
        template_bytes: bytes,
    ) -> bytes:
        """
        Generate a DOCX document using a template as the base.

        Delegated to DocxService.
        """
        return await self._docx_service.generate_docx_from_template(
            content=content,
            template_bytes=template_bytes,
        )


# Global service instance
_template_service: Optional[TemplateService] = None


def get_template_service() -> TemplateService:
    """Get or create the global Template service instance."""
    global _template_service
    if _template_service is None:
        _template_service = TemplateService()
    return _template_service


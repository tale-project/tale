"""
DOCX Service for Word document generation.

Handles:
- DOCX generation from structured content (no template needed)
"""

import logging
from io import BytesIO
from typing import Optional, Dict, Any

import httpx
from docx import Document
from docx.shared import Inches as DocxInches, Pt as DocxPt
from docx.enum.text import WD_ALIGN_PARAGRAPH

logger = logging.getLogger(__name__)


class DocxService:
    """Service for generating DOCX documents."""

    def __init__(self):
        self._http_client: Optional[httpx.AsyncClient] = None

    async def _get_http_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client."""
        if self._http_client is None:
            self._http_client = httpx.AsyncClient(timeout=60.0)
        return self._http_client

    async def cleanup(self):
        """Cleanup resources."""
        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None

    async def download_file(self, url: str) -> bytes:
        """Download a file from URL."""
        client = await self._get_http_client()
        response = await client.get(url)
        response.raise_for_status()
        return response.content

    async def generate_docx(
        self,
        content: Dict[str, Any],
        branding: Optional[Dict[str, Any]] = None,
    ) -> bytes:
        """
        Generate a DOCX document from structured content.

        Args:
            content: Document content structure:
                {
                    "title": "Document Title",
                    "subtitle": "Optional subtitle",
                    "sections": [
                        {"type": "heading", "level": 1, "text": "Section Title"},
                        {"type": "paragraph", "text": "Paragraph text..."},
                        {"type": "bullets", "items": ["Item 1", "Item 2"]},
                        {"type": "numbered", "items": ["First", "Second"]},
                        {"type": "table", "headers": [...], "rows": [[...], [...]]},
                    ]
                }
            branding: Optional branding info:
                {
                    "logo_url": "https://...",
                    "company_name": "Acme Corp",
                    "primary_color": "#0066cc",
                }

        Returns:
            Generated DOCX as bytes
        """
        doc = Document()

        # Add company logo if provided
        if branding and branding.get("logo_url"):
            try:
                logo_bytes = await self.download_file(branding["logo_url"])
                logo_stream = BytesIO(logo_bytes)
                doc.add_picture(logo_stream, width=DocxInches(2))
                doc.add_paragraph()  # Spacer
            except Exception as e:
                logger.warning(f"Failed to add logo: {e}")

        # Add title
        title_text = content.get("title", "Untitled Document")
        title = doc.add_heading(title_text, level=0)
        title.alignment = WD_ALIGN_PARAGRAPH.CENTER

        # Add subtitle if present
        subtitle_text = content.get("subtitle")
        if subtitle_text:
            subtitle = doc.add_paragraph(subtitle_text)
            subtitle.alignment = WD_ALIGN_PARAGRAPH.CENTER
            doc.add_paragraph()  # Spacer

        # Process sections
        sections = content.get("sections", [])
        for section in sections:
            self._process_section(doc, section)

        # Save to bytes
        output = BytesIO()
        doc.save(output)
        return output.getvalue()

    def _process_section(self, doc: Document, section: Dict[str, Any]) -> None:
        """Process a single section and add it to the document."""
        section_type = section.get("type", "paragraph")

        if section_type == "heading":
            level = section.get("level", 1)
            doc.add_heading(section.get("text", ""), level=level)

        elif section_type == "paragraph":
            doc.add_paragraph(section.get("text", ""))

        elif section_type == "bullets":
            items = section.get("items", [])
            for item in items:
                doc.add_paragraph(item, style='List Bullet')

        elif section_type == "numbered":
            items = section.get("items", [])
            for item in items:
                doc.add_paragraph(item, style='List Number')

        elif section_type == "table":
            self._add_table(doc, section)

        elif section_type == "quote":
            quote_para = doc.add_paragraph(section.get("text", ""))
            quote_para.style = 'Quote'

        elif section_type == "code":
            code_text = section.get("text", "")
            code_para = doc.add_paragraph()
            code_run = code_para.add_run(code_text)
            code_run.font.name = 'Courier New'
            code_run.font.size = DocxPt(10)

    def _add_table(self, doc: Document, section: Dict[str, Any]) -> None:
        """Add a table to the document."""
        headers = section.get("headers", [])
        rows = section.get("rows", [])

        if not headers:
            return

        table = doc.add_table(rows=1, cols=len(headers))
        table.style = 'Table Grid'

        # Add headers
        header_row = table.rows[0]
        for i, header in enumerate(headers):
            cell = header_row.cells[i]
            cell.text = str(header)
            for paragraph in cell.paragraphs:
                for run in paragraph.runs:
                    run.bold = True

        # Add data rows
        for row_data in rows:
            row = table.add_row()
            for i, cell_value in enumerate(row_data):
                if i < len(row.cells):
                    row.cells[i].text = str(cell_value)

        doc.add_paragraph()  # Spacer after table


# Global service instance
_docx_service: Optional[DocxService] = None


def get_docx_service() -> DocxService:
    """Get or create the global DOCX service instance."""
    global _docx_service
    if _docx_service is None:
        _docx_service = DocxService()
    return _docx_service


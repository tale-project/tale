"""
File Parser Service for extracting text content from documents.

Handles:
- PDF text extraction using PyMuPDF
- DOCX text extraction using python-docx
- PPTX text extraction using python-pptx
"""

import logging
from io import BytesIO
from typing import Any

logger = logging.getLogger(__name__)


class FileParserService:
    """Service for parsing and extracting text from various document formats."""

    def parse_pdf(self, file_bytes: bytes, filename: str = "document.pdf") -> dict[str, Any]:
        """Extract text content from a PDF file."""
        import fitz  # PyMuPDF

        try:
            doc = fitz.open(stream=file_bytes, filetype="pdf")
            pages = []
            full_text = []
            
            for page_num, page in enumerate(doc, start=1):
                text = page.get_text("text")
                pages.append({"page_number": page_num, "text": text.strip()})
                full_text.append(text)
            
            metadata = doc.metadata or {}
            doc.close()
            
            return {
                "success": True,
                "filename": filename,
                "file_type": "application/pdf",
                "page_count": len(pages),
                "pages": pages,
                "full_text": "\n\n".join(full_text).strip(),
                "metadata": {
                    "title": metadata.get("title", ""),
                    "author": metadata.get("author", ""),
                    "subject": metadata.get("subject", ""),
                },
            }
        except Exception as e:
            logger.error(f"Error parsing PDF: {e}")
            return {"success": False, "filename": filename, "file_type": "application/pdf", "error": str(e)}

    def parse_docx(self, file_bytes: bytes, filename: str = "document.docx") -> dict[str, Any]:
        """Extract text content from a DOCX file."""
        from docx import Document

        try:
            doc = Document(BytesIO(file_bytes))
            paragraphs = []
            for para in doc.paragraphs:
                text = para.text.strip()
                if text:
                    paragraphs.append({"text": text, "style": para.style.name if para.style else None})
            
            tables = []
            for table in doc.tables:
                table_data = [[cell.text.strip() for cell in row.cells] for row in table.rows]
                if table_data:
                    tables.append(table_data)
            
            full_text = "\n".join(p["text"] for p in paragraphs)
            core_props = doc.core_properties
            
            return {
                "success": True,
                "filename": filename,
                "file_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "paragraph_count": len(paragraphs),
                "table_count": len(tables),
                "paragraphs": paragraphs,
                "tables": tables,
                "full_text": full_text,
                "metadata": {"title": core_props.title or "", "author": core_props.author or ""},
            }
        except Exception as e:
            logger.error(f"Error parsing DOCX: {e}")
            return {"success": False, "filename": filename, "error": str(e)}

    def parse_pptx(self, file_bytes: bytes, filename: str = "presentation.pptx") -> dict[str, Any]:
        """Extract text content from a PPTX file."""
        from pptx import Presentation

        try:
            prs = Presentation(BytesIO(file_bytes))
            slides = []
            full_text_parts = []
            
            for slide_num, slide in enumerate(prs.slides, start=1):
                slide_text = []
                for shape in slide.shapes:
                    if shape.has_text_frame:
                        for paragraph in shape.text_frame.paragraphs:
                            text = paragraph.text.strip()
                            if text:
                                slide_text.append(text)
                    if shape.has_table:
                        for row in shape.table.rows:
                            for cell in row.cells:
                                text = cell.text.strip()
                                if text:
                                    slide_text.append(text)
                
                slides.append({
                    "slide_number": slide_num,
                    "text_content": slide_text,
                    "full_text": "\n".join(slide_text),
                })
                full_text_parts.extend(slide_text)
            
            core_props = prs.core_properties
            return {
                "success": True,
                "filename": filename,
                "file_type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                "slide_count": len(slides),
                "slides": slides,
                "full_text": "\n\n".join(full_text_parts),
                "metadata": {"title": core_props.title or "", "author": core_props.author or ""},
            }
        except Exception as e:
            logger.error(f"Error parsing PPTX: {e}")
            return {"success": False, "filename": filename, "error": str(e)}

    def parse_file(self, file_bytes: bytes, filename: str, content_type: str = "") -> dict[str, Any]:
        """Parse a file based on its content type or filename extension."""
        filename_lower = filename.lower()
        content_type_lower = content_type.lower() if content_type else ""
        
        if filename_lower.endswith(".pdf") or "pdf" in content_type_lower:
            return self.parse_pdf(file_bytes, filename)
        elif filename_lower.endswith(".docx") or "wordprocessingml" in content_type_lower:
            return self.parse_docx(file_bytes, filename)
        elif filename_lower.endswith(".pptx") or "presentationml" in content_type_lower:
            return self.parse_pptx(file_bytes, filename)
        else:
            return {
                "success": False,
                "filename": filename,
                "error": f"Unsupported file type: {filename} ({content_type}). Supported: PDF, DOCX, PPTX.",
            }


# Global file parser service instance
_file_parser_service: FileParserService | None = None


def get_file_parser_service() -> FileParserService:
    """Get or create the file parser service instance."""
    global _file_parser_service
    if _file_parser_service is None:
        _file_parser_service = FileParserService()
    return _file_parser_service

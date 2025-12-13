"""
PDF Converter Service.

Converts HTML, Markdown, and URLs to PDF documents using Playwright.
"""

from typing import Optional

from app.models import WaitUntilType
from app.services.base_converter import BaseConverterService


class PdfService(BaseConverterService):
    """Service for converting documents to PDF."""

    async def html_to_pdf(
        self,
        html: str,
        wrap_in_template: bool = True,
        format: str = "A4",
        landscape: bool = False,
        margin_top: str = "20mm",
        margin_bottom: str = "20mm",
        margin_left: str = "20mm",
        margin_right: str = "20mm",
        print_background: bool = True,
        extra_css: Optional[str] = None,
    ) -> bytes:
        """Convert HTML to PDF."""
        page = await self._get_page()
        try:
            # Wrap in template if requested
            if wrap_in_template:
                extra_head = f"<style>{extra_css}</style>" if extra_css else ""
                html = self._wrap_html(html, extra_head)
            elif extra_css:
                # Inject CSS into existing HTML
                html = html.replace("</head>", f"<style>{extra_css}</style></head>")

            await page.set_content(html, wait_until="networkidle")

            # Wait for Twemoji to parse and render all emojis
            await self._wait_for_twemoji(page)

            pdf_bytes = await page.pdf(
                format=format,
                landscape=landscape,
                margin={
                    "top": margin_top,
                    "bottom": margin_bottom,
                    "left": margin_left,
                    "right": margin_right,
                },
                print_background=print_background,
            )
            return pdf_bytes
        finally:
            await page.close()

    async def markdown_to_pdf(
        self,
        markdown: str,
        **pdf_options,
    ) -> bytes:
        """Convert Markdown to PDF."""
        html = await self.markdown_to_html(markdown)
        return await self.html_to_pdf(html, wrap_in_template=True, **pdf_options)

    async def url_to_pdf(
        self,
        url: str,
        wait_until: WaitUntilType = "networkidle",
        **pdf_options,
    ) -> bytes:
        """Capture a URL as PDF."""
        page = await self._get_page()
        try:
            await page.goto(url, wait_until=wait_until)

            # Remove wrap_in_template if passed (not applicable for URL)
            pdf_options.pop("wrap_in_template", None)

            pdf_bytes = await page.pdf(
                format=pdf_options.get("format", "A4"),
                landscape=pdf_options.get("landscape", False),
                margin={
                    "top": pdf_options.get("margin_top", "20mm"),
                    "bottom": pdf_options.get("margin_bottom", "20mm"),
                    "left": pdf_options.get("margin_left", "20mm"),
                    "right": pdf_options.get("margin_right", "20mm"),
                },
                print_background=pdf_options.get("print_background", True),
            )
            return pdf_bytes
        finally:
            await page.close()


# Global service instance
_pdf_service: Optional[PdfService] = None


def get_pdf_service() -> PdfService:
    """Get or create the global PDF service instance."""
    global _pdf_service
    if _pdf_service is None:
        _pdf_service = PdfService()
    return _pdf_service


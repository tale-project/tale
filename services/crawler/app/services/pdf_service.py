"""
PDF Converter Service.

Converts HTML, Markdown, and URLs to PDF documents using Playwright.
"""

import re
from typing import Any

from app.models import WaitUntilType
from app.services.base_converter import BaseConverterService


class PdfService(BaseConverterService):
    """Service for converting documents to PDF."""

    def _inject_css(self, html: str, css: str) -> str:
        """Inject CSS into HTML document robustly.

        Injection strategy (in order of preference):
        1. Inside existing <head> tag (case-insensitive)
        2. Before <body> tag if no <head> found
        3. At the top of the document as fallback

        Args:
            html: The HTML document to inject CSS into.
            css: The CSS content to inject (without <style> tags).

        Returns:
            The HTML document with CSS injected.
        """
        if not css or not css.strip():
            return html

        style_block = f"<style>{css}</style>"

        # Try to find </head> tag (case-insensitive)
        head_close_pattern = re.compile(r"(</head\s*>)", re.IGNORECASE)
        head_close_match = head_close_pattern.search(html)
        if head_close_match:
            # Insert before </head>
            insert_pos = head_close_match.start()
            return html[:insert_pos] + style_block + html[insert_pos:]

        # Try to find <head...> tag to insert after it (case-insensitive)
        head_open_pattern = re.compile(r"(<head(?:\s[^>]*)?>)", re.IGNORECASE)
        head_open_match = head_open_pattern.search(html)
        if head_open_match:
            # Insert right after <head>
            insert_pos = head_open_match.end()
            return html[:insert_pos] + style_block + html[insert_pos:]

        # Try to find <body...> tag and insert before it (case-insensitive)
        body_pattern = re.compile(r"(<body(?:\s[^>]*)?>)", re.IGNORECASE)
        body_match = body_pattern.search(html)
        if body_match:
            # Insert before <body>
            insert_pos = body_match.start()
            return html[:insert_pos] + style_block + html[insert_pos:]

        # Fallback: prepend at the top of the document
        return style_block + html

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
        extra_css: str | None = None,
    ) -> bytes:
        """Convert HTML to PDF."""
        page = await self._get_page()
        try:
            # Wrap in template if requested
            if wrap_in_template:
                extra_head = f"<style>{extra_css}</style>" if extra_css else ""
                html = self._wrap_html(html, extra_head)
            elif extra_css:
                # Inject CSS into existing HTML robustly
                html = self._inject_css(html, extra_css)

            await page.set_content(html, wait_until="domcontentloaded")

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
        **pdf_options: Any,
    ) -> bytes:
        """Convert Markdown to PDF."""
        html = await self.markdown_to_html(markdown)
        return await self.html_to_pdf(html, wrap_in_template=True, **pdf_options)

    async def url_to_pdf(
        self,
        url: str,
        wait_until: WaitUntilType = "load",
        timeout: int = 60000,
        **pdf_options: Any,
    ) -> bytes:
        """Capture a URL as PDF.

        Uses a fallback strategy: tries 'load' event first, falls back to 'domcontentloaded'
        if 'load' times out. This handles sites with slow/failing external resources.
        """
        from playwright.async_api import TimeoutError as PlaywrightTimeoutError

        page = await self._get_page()
        try:
            # Navigate with domcontentloaded first (fast, reliable), then optionally wait for load
            await page.goto(url, wait_until="domcontentloaded", timeout=timeout)

            # If 'load' was requested, try to wait for it but don't fail if it times out
            if wait_until == "load":
                try:
                    await page.wait_for_load_state("load", timeout=timeout)
                except PlaywrightTimeoutError:
                    # 'load' event didn't fire within timeout, continue with domcontentloaded state
                    pass

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
_pdf_service: PdfService | None = None


def get_pdf_service() -> PdfService:
    """Get or create the global PDF service instance."""
    global _pdf_service
    if _pdf_service is None:
        _pdf_service = PdfService()
    return _pdf_service


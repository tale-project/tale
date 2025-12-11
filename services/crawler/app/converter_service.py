"""
Document Converter Service using Playwright.

Converts HTML/Markdown to PDF and images using the headless browser
already available in the crawler service.
"""

import asyncio
import logging
from typing import Optional, Literal

from playwright.async_api import async_playwright, Browser, Page

from app.models import WaitUntilType

logger = logging.getLogger(__name__)

# Default HTML template for rendering content
# Uses Noto fonts for multi-language support:
# - Noto Sans: Latin (English, German, French, Spanish), Cyrillic (Russian)
# - Noto Sans CJK: Chinese, Japanese, Korean
# - Twemoji: Color emoji support via SVG images (loaded from CDN)
# - DejaVu Sans: Fallback with broad Unicode coverage
DEFAULT_HTML_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <!-- Twemoji for color emoji support in PDF -->
    <script src="https://cdn.jsdelivr.net/npm/@twemoji/api@latest/dist/twemoji.min.js" crossorigin="anonymous"></script>
    <style>
        * {{ box-sizing: border-box; }}
        body {{
            font-family: 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans CJK JP', 'Noto Sans CJK KR', 'DejaVu Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.8;
            color: #333;
            max-width: 800px;
            margin: 0 auto;
            padding: 40px;
            background: white;
        }}
        h1 {{ font-size: 2em; margin-top: 0; border-bottom: 2px solid #eee; padding-bottom: 0.3em; }}
        h2 {{ font-size: 1.5em; border-bottom: 1px solid #eee; padding-bottom: 0.3em; }}
        h3 {{ font-size: 1.25em; }}
        code {{
            background: #f5f5f5;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: 'Noto Sans Mono', 'DejaVu Sans Mono', 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace;
            font-size: 0.9em;
        }}
        pre {{
            background: #f5f5f5;
            padding: 16px;
            border-radius: 8px;
            overflow-x: auto;
        }}
        pre code {{ background: none; padding: 0; }}
        blockquote {{
            border-left: 4px solid #ddd;
            margin: 0;
            padding-left: 16px;
            color: #666;
        }}
        table {{
            border-collapse: collapse;
            width: 100%;
            margin: 1em 0;
        }}
        th, td {{
            border: 1px solid #ddd;
            padding: 8px 12px;
            text-align: left;
        }}
        th {{ background: #f5f5f5; font-weight: 600; }}
        img {{ max-width: 100%; height: auto; }}
        /* Twemoji emoji styling */
        img.emoji {{
            height: 1.2em;
            width: 1.2em;
            margin: 0 .05em 0 .1em;
            vertical-align: -0.15em;
        }}
        a {{ color: #0066cc; }}
        hr {{ border: none; border-top: 1px solid #eee; margin: 2em 0; }}
        ul, ol {{ padding-left: 2em; }}
        li {{ margin: 0.5em 0; }}
    </style>
    {extra_head}
</head>
<body>
    {content}
    <script>
        // Parse emojis and replace with Twemoji images
        if (typeof twemoji !== 'undefined') {{
            twemoji.parse(document.body, {{
                folder: 'svg',
                ext: '.svg'
            }});
        }}
    </script>
</body>
</html>
"""


class ConverterService:
    """Service for converting documents using Playwright."""

    def __init__(self):
        self.initialized = False
        self._playwright = None
        self._browser: Optional[Browser] = None
        self._lock = asyncio.Lock()

    async def initialize(self):
        """Initialize Playwright browser."""
        if self.initialized:
            return

        async with self._lock:
            if self.initialized:
                return

            logger.info("Initializing Playwright for document conversion...")
            self._playwright = await async_playwright().start()
            self._browser = await self._playwright.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                ],
            )
            self.initialized = True
            logger.info("Playwright initialized for document conversion")

    async def cleanup(self):
        """Cleanup Playwright resources."""
        if not self.initialized:
            return

        async with self._lock:
            if self._browser:
                await self._browser.close()
            if self._playwright:
                await self._playwright.stop()
            self.initialized = False
            self._browser = None
            self._playwright = None
            logger.info("Playwright cleaned up")

    async def _get_page(self) -> Page:
        """Get a new browser page."""
        if not self.initialized:
            await self.initialize()
        return await self._browser.new_page()

    def _wrap_html(self, content: str, extra_head: str = "") -> str:
        """Wrap content in HTML template."""
        return DEFAULT_HTML_TEMPLATE.format(content=content, extra_head=extra_head)

    async def markdown_to_html(self, markdown: str) -> str:
        """Convert markdown to HTML using Python-Markdown."""
        import markdown as md

        # Convert markdown to HTML with common extensions
        html = md.markdown(
            markdown,
            extensions=[
                "tables",
                "fenced_code",
                "codehilite",
                "toc",
                "nl2br",
            ],
        )
        return html

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
            await page.wait_for_function(
                "() => typeof twemoji === 'undefined' || document.querySelectorAll('img.emoji').length > 0 || !document.body.textContent.match(/[\\u{1F300}-\\u{1F9FF}]/u)",
                timeout=5000
            )
            # Small delay to ensure all emoji images are loaded
            await asyncio.sleep(0.3)

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

    async def html_to_image(
        self,
        html: str,
        wrap_in_template: bool = True,
        image_type: Literal["png", "jpeg"] = "png",
        quality: int = 90,
        full_page: bool = True,
        width: int = 800,
        extra_css: Optional[str] = None,
    ) -> bytes:
        """Convert HTML to image (PNG or JPEG)."""
        page = await self._get_page()
        try:
            # Set viewport width
            await page.set_viewport_size({"width": width, "height": 600})

            # Wrap in template if requested
            if wrap_in_template:
                extra_head = f"<style>{extra_css}</style>" if extra_css else ""
                html = self._wrap_html(html, extra_head)
            elif extra_css:
                html = html.replace("</head>", f"<style>{extra_css}</style></head>")

            await page.set_content(html, wait_until="networkidle")

            # Wait for Twemoji to parse and render all emojis
            await page.wait_for_function(
                "() => typeof twemoji === 'undefined' || document.querySelectorAll('img.emoji').length > 0 || !document.body.textContent.match(/[\\u{1F300}-\\u{1F9FF}]/u)",
                timeout=5000
            )
            # Small delay to ensure all emoji images are loaded
            await asyncio.sleep(0.3)

            screenshot_options = {
                "type": image_type,
                "full_page": full_page,
            }
            if image_type == "jpeg":
                screenshot_options["quality"] = quality

            image_bytes = await page.screenshot(**screenshot_options)
            return image_bytes
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

    async def markdown_to_image(
        self,
        markdown: str,
        **image_options,
    ) -> bytes:
        """Convert Markdown to image."""
        html = await self.markdown_to_html(markdown)
        return await self.html_to_image(html, wrap_in_template=True, **image_options)

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

    async def url_to_image(
        self,
        url: str,
        wait_until: WaitUntilType = "networkidle",
        image_type: Literal["png", "jpeg"] = "png",
        quality: int = 90,
        full_page: bool = True,
        width: int = 1280,
        height: int = 800,
    ) -> bytes:
        """Capture a URL as image (screenshot)."""
        page = await self._get_page()
        try:
            await page.set_viewport_size({"width": width, "height": height})
            await page.goto(url, wait_until=wait_until)

            screenshot_options = {
                "type": image_type,
                "full_page": full_page,
            }
            if image_type == "jpeg":
                screenshot_options["quality"] = quality

            image_bytes = await page.screenshot(**screenshot_options)
            return image_bytes
        finally:
            await page.close()


# Global service instance
_converter_service: Optional[ConverterService] = None


def get_converter_service() -> ConverterService:
    """Get or create the global Converter service instance."""
    global _converter_service
    if _converter_service is None:
        _converter_service = ConverterService()
    return _converter_service


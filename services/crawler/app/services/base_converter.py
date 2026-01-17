"""
Base Converter Service using Playwright.

Provides shared infrastructure for document conversion services:
- Playwright browser management (initialization, cleanup)
- HTML template with multi-language and emoji support
- Markdown to HTML conversion
- Common helper methods
"""

import asyncio
import logging

from playwright.async_api import Browser, Page, async_playwright

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
            font-family: 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans CJK JP', 'Noto Sans CJK KR',
                'DejaVu Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
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

# JavaScript function to check if Twemoji has finished parsing
TWEMOJI_WAIT_SCRIPT = (
    "() => typeof twemoji === 'undefined' || "
    "document.querySelectorAll('img.emoji').length > 0 || "
    "!document.body.textContent.match(/[\\u{1F300}-\\u{1F9FF}]/u)"
)


class BaseConverterService:
    """Base service for document conversion using Playwright."""

    def __init__(self) -> None:
        self.initialized = False
        self._playwright = None
        self._browser: Browser | None = None
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

    async def _wait_for_twemoji(self, page: Page, timeout: int = 5000) -> None:
        """Wait for Twemoji to parse and render all emojis."""
        await page.wait_for_function(TWEMOJI_WAIT_SCRIPT, timeout=timeout)
        # Small delay to ensure all emoji images are loaded
        await asyncio.sleep(0.3)

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


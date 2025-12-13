"""
Image Converter Service.

Converts HTML, Markdown, and URLs to images (PNG/JPEG) using Playwright.
"""

from typing import Optional, Literal

from app.models import WaitUntilType
from app.services.base_converter import BaseConverterService


class ImageService(BaseConverterService):
    """Service for converting documents to images."""

    async def html_to_image(
        self,
        html: str,
        wrap_in_template: bool = True,
        image_type: Literal["png", "jpeg"] = "png",
        quality: int = 100,
        full_page: bool = True,
        width: int = 1200,
        extra_css: Optional[str] = None,
        scale: float = 2.0,
    ) -> bytes:
        """Convert HTML to image (PNG or JPEG)."""
        page = await self._get_page()
        try:
            # Set viewport with device scale factor for high-quality rendering
            await page.set_viewport_size({"width": width, "height": 600})

            # Wrap in template if requested
            if wrap_in_template:
                extra_head = f"<style>{extra_css}</style>" if extra_css else ""
                html = self._wrap_html(html, extra_head)
            elif extra_css:
                html = html.replace("</head>", f"<style>{extra_css}</style></head>")

            await page.set_content(html, wait_until="networkidle")

            # Wait for Twemoji to parse and render all emojis
            await self._wait_for_twemoji(page)

            screenshot_options = {
                "type": image_type,
                "full_page": full_page,
                "scale": "device" if scale > 1.0 else "css",
            }
            if image_type == "jpeg":
                screenshot_options["quality"] = quality

            # Set device scale factor for high-quality output
            await page.evaluate(f"() => {{ window.devicePixelRatio = {scale}; }}")

            image_bytes = await page.screenshot(**screenshot_options)
            return image_bytes
        finally:
            await page.close()

    async def markdown_to_image(
        self,
        markdown: str,
        **image_options,
    ) -> bytes:
        """Convert Markdown to image."""
        html = await self.markdown_to_html(markdown)
        return await self.html_to_image(html, wrap_in_template=True, **image_options)

    async def url_to_image(
        self,
        url: str,
        wait_until: WaitUntilType = "networkidle",
        image_type: Literal["png", "jpeg"] = "png",
        quality: int = 100,
        full_page: bool = True,
        width: int = 1280,
        height: int = 800,
        scale: float = 2.0,
    ) -> bytes:
        """Capture a URL as image (screenshot)."""
        page = await self._get_page()
        try:
            await page.set_viewport_size({"width": width, "height": height})
            await page.goto(url, wait_until=wait_until)

            screenshot_options = {
                "type": image_type,
                "full_page": full_page,
                "scale": "device" if scale > 1.0 else "css",
            }
            if image_type == "jpeg":
                screenshot_options["quality"] = quality

            # Set device scale factor for high-quality output
            await page.evaluate(f"() => {{ window.devicePixelRatio = {scale}; }}")

            image_bytes = await page.screenshot(**screenshot_options)
            return image_bytes
        finally:
            await page.close()


# Global service instance
_image_service: Optional[ImageService] = None


def get_image_service() -> ImageService:
    """Get or create the global Image service instance."""
    global _image_service
    if _image_service is None:
        _image_service = ImageService()
    return _image_service


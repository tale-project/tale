"""
Image Converter Service.

Converts HTML, Markdown, and URLs to images (PNG/JPEG) using Playwright.
"""

from typing import Optional, Literal

from loguru import logger

from app.models import WaitUntilType
from app.services.base_converter import BaseConverterService


class ImageService(BaseConverterService):
    """Service for converting documents to images."""

    async def _dismiss_cookie_dialogs(self, page) -> None:
        """Attempt to dismiss common cookie consent dialogs."""
        # Common selectors for cookie consent buttons (accept/reject/close)
        cookie_button_selectors = [
            # Accept buttons
            '[id*="accept" i][id*="cookie" i]',
            '[class*="accept" i][class*="cookie" i]',
            'button[id*="accept" i]',
            'button[class*="accept" i]',
            '[data-testid*="accept" i]',
            # Reject/Decline buttons
            '[id*="reject" i][id*="cookie" i]',
            '[class*="reject" i][class*="cookie" i]',
            '[id*="decline" i]',
            # Close buttons on cookie banners
            '[class*="cookie" i] [class*="close" i]',
            '[id*="cookie" i] button[class*="close" i]',
            # Common cookie consent frameworks
            '#onetrust-accept-btn-handler',
            '.onetrust-close-btn-handler',
            '#CybotCookiebotDialogBodyButtonAccept',
            '#CybotCookiebotDialogBodyButtonDecline',
            '.cc-btn.cc-dismiss',
            '.cc-btn.cc-allow',
            '[data-cookie-consent="accept"]',
            '[data-gdpr-consent="accept"]',
            # Generic patterns
            'button:has-text("Accept")',
            'button:has-text("Accept all")',
            'button:has-text("Accept cookies")',
            'button:has-text("I agree")',
            'button:has-text("Got it")',
            'button:has-text("OK")',
            'button:has-text("Agree")',
            'button:has-text("Allow")',
            'button:has-text("Allow all")',
            'a:has-text("Accept")',
            'a:has-text("Accept all")',
        ]

        for selector in cookie_button_selectors:
            try:
                button = page.locator(selector).first
                if await button.is_visible(timeout=100):
                    await button.click(timeout=500)
                    logger.debug(f"Dismissed cookie dialog with selector: {selector}")
                    await page.wait_for_timeout(300)
                    return
            except Exception:
                continue

        # Fallback: try to hide common cookie banner elements via CSS
        await page.evaluate("""
            () => {
                const selectors = [
                    '[id*="cookie" i][id*="banner" i]',
                    '[id*="cookie" i][id*="consent" i]',
                    '[class*="cookie" i][class*="banner" i]',
                    '[class*="cookie" i][class*="consent" i]',
                    '[class*="cookie" i][class*="popup" i]',
                    '[class*="cookie" i][class*="modal" i]',
                    '[class*="gdpr" i]',
                    '#onetrust-banner-sdk',
                    '#CybotCookiebotDialog',
                    '.cc-window',
                    '[aria-label*="cookie" i]',
                ];
                for (const selector of selectors) {
                    document.querySelectorAll(selector).forEach(el => {
                        el.style.display = 'none';
                    });
                }
            }
        """)

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
        wait_until: WaitUntilType = "load",
        image_type: Literal["png", "jpeg"] = "png",
        quality: int = 100,
        full_page: bool = True,
        width: int = 1920,
        height: int = 1080,
        scale: float = 2.0,
        timeout: int = 60000,
    ) -> bytes:
        """Capture a URL as image (screenshot).

        Uses a fallback strategy: tries 'load' event first, falls back to 'domcontentloaded'
        if 'load' times out. This handles sites with slow/failing external resources.
        """
        from playwright.async_api import TimeoutError as PlaywrightTimeoutError

        logger.info(f"Capturing screenshot: {url} ({width}x{height})")
        page = await self._get_page()

        try:
            await page.set_viewport_size({"width": width, "height": height})

            # Navigate with domcontentloaded first (fast, reliable), then optionally wait for load
            await page.goto(url, wait_until="domcontentloaded", timeout=timeout)

            # If 'load' was requested, try to wait for it but don't fail if it times out
            if wait_until == "load":
                try:
                    await page.wait_for_load_state("load", timeout=timeout)
                except PlaywrightTimeoutError:
                    logger.warning(f"'load' event timed out after {timeout}ms, continuing with domcontentloaded state")

            # Dismiss cookie consent dialogs before taking screenshot
            await self._dismiss_cookie_dialogs(page)

            # For full-page screenshots, scroll through the page to trigger lazy-loaded images
            if full_page:
                await page.evaluate("""
                    async () => {
                        const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
                        const scrollHeight = document.body.scrollHeight;
                        const viewportHeight = window.innerHeight;

                        // Scroll down in steps
                        for (let y = 0; y < scrollHeight; y += viewportHeight) {
                            window.scrollTo(0, y);
                            await delay(100);
                        }

                        // Scroll back to top
                        window.scrollTo(0, 0);
                        await delay(200);
                    }
                """)

            # Small additional wait for lazy-loaded content to finish loading
            await page.wait_for_timeout(500)

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
            logger.info(f"Screenshot completed: {len(image_bytes)} bytes")
            return image_bytes
        except Exception as e:
            logger.error(f"Error capturing screenshot for {url}: {e}")
            raise
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


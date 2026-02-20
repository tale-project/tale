"""Browser context pool for concurrent request handling.

Manages a persistent Chromium browser instance and creates isolated
BrowserContext instances per request. Replaces WorkspaceManager.
"""

import asyncio

from loguru import logger
from playwright.async_api import Browser, BrowserContext, Playwright, async_playwright

from app.config import settings


class BrowserPool:
    """Persistent Chromium browser with per-request context isolation.

    Lifecycle:
    - initialize(): launches Playwright + Chromium once
    - acquire() -> BrowserContext: creates a fresh isolated context
    - release(context): closes the context
    - shutdown(): closes browser + playwright
    """

    def __init__(self) -> None:
        self._playwright: Playwright | None = None
        self._browser: Browser | None = None
        self._semaphore: asyncio.Semaphore | None = None
        self._initialized = False
        self._lock = asyncio.Lock()

    @property
    def initialized(self) -> bool:
        return self._initialized

    async def initialize(self) -> None:
        if self._initialized:
            return

        async with self._lock:
            if self._initialized:
                return

            self._playwright = await async_playwright().start()
            self._browser = await self._playwright.chromium.launch(
                headless=settings.headless,
                args=[
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                ],
            )
            self._browser.on("disconnected", lambda: asyncio.create_task(self._on_browser_disconnected()))
            self._semaphore = asyncio.Semaphore(settings.max_concurrent_requests)
            self._initialized = True
            logger.info(
                f"BrowserPool initialized: max_concurrent={settings.max_concurrent_requests}, "
                f"headless={settings.headless}"
            )

    async def _on_browser_disconnected(self) -> None:
        logger.error("Browser disconnected unexpectedly, marking pool as uninitialized for relaunch")
        self._initialized = False
        self._browser = None

    async def acquire(self) -> BrowserContext:
        """Acquire a fresh browser context for a request.

        Blocks if the concurrency limit is reached.
        """
        if not self._initialized:
            await self.initialize()

        assert self._semaphore is not None
        assert self._browser is not None

        await self._semaphore.acquire()
        try:
            context = await self._browser.new_context(
                viewport={"width": 1280, "height": 720},
                java_script_enabled=True,
                ignore_https_errors=True,
            )
            return context
        except Exception:
            self._semaphore.release()
            raise

    async def release(self, context: BrowserContext) -> None:
        """Release (close) a browser context after request completion."""
        assert self._semaphore is not None
        try:
            await context.close()
        except Exception as e:
            logger.warning(f"Error closing browser context: {e}")
        finally:
            self._semaphore.release()

    async def shutdown(self) -> None:
        """Shut down the browser and Playwright."""
        if self._browser:
            try:
                await self._browser.close()
            except Exception as e:
                logger.warning(f"Error closing browser: {e}")
            self._browser = None

        if self._playwright:
            try:
                await self._playwright.stop()
            except Exception as e:
                logger.warning(f"Error stopping playwright: {e}")
            self._playwright = None

        self._initialized = False
        logger.info("BrowserPool shut down")


_browser_pool: BrowserPool | None = None


def get_browser_pool() -> BrowserPool:
    """Get the singleton browser pool instance."""
    global _browser_pool
    if _browser_pool is None:
        _browser_pool = BrowserPool()
    return _browser_pool

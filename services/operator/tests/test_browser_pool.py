"""Tests for BrowserPool."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.browser_pool import BrowserPool


def _mock_playwright():
    """Create mock Playwright with browser and context."""
    mock_context = AsyncMock()
    mock_browser = AsyncMock()
    mock_browser.new_context = AsyncMock(return_value=mock_context)
    mock_browser.close = AsyncMock()
    mock_browser.on = MagicMock()

    mock_pw = AsyncMock()
    mock_pw.chromium.launch = AsyncMock(return_value=mock_browser)
    mock_pw.stop = AsyncMock()

    return mock_pw, mock_browser, mock_context


@pytest.fixture
def pool():
    return BrowserPool()


class TestInitialize:
    @pytest.mark.asyncio
    async def test_initialize_launches_browser(self, pool):
        mock_pw, _, _ = _mock_playwright()

        with patch("app.services.browser_pool.async_playwright") as mock_apw:
            mock_apw.return_value.start = AsyncMock(return_value=mock_pw)
            await pool.initialize()

        assert pool.initialized
        mock_pw.chromium.launch.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_double_initialize_is_idempotent(self, pool):
        mock_pw, _, _ = _mock_playwright()

        with patch("app.services.browser_pool.async_playwright") as mock_apw:
            mock_apw.return_value.start = AsyncMock(return_value=mock_pw)
            await pool.initialize()
            await pool.initialize()

        mock_pw.chromium.launch.assert_awaited_once()


class TestAcquireRelease:
    @pytest.mark.asyncio
    async def test_acquire_returns_context(self, pool):
        mock_pw, mock_browser, mock_context = _mock_playwright()

        with patch("app.services.browser_pool.async_playwright") as mock_apw:
            mock_apw.return_value.start = AsyncMock(return_value=mock_pw)
            await pool.initialize()

        ctx = await pool.acquire()
        assert ctx is mock_context
        mock_browser.new_context.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_release_closes_context(self, pool):
        mock_pw, _, mock_context = _mock_playwright()

        with patch("app.services.browser_pool.async_playwright") as mock_apw:
            mock_apw.return_value.start = AsyncMock(return_value=mock_pw)
            await pool.initialize()

        ctx = await pool.acquire()
        await pool.release(ctx)
        mock_context.close.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_release_releases_semaphore_even_on_close_error(self, pool):
        mock_pw, _, mock_context = _mock_playwright()
        mock_context.close = AsyncMock(side_effect=RuntimeError("close failed"))

        with patch("app.services.browser_pool.async_playwright") as mock_apw:
            mock_apw.return_value.start = AsyncMock(return_value=mock_pw)
            with patch("app.services.browser_pool.settings") as mock_settings:
                mock_settings.max_concurrent_requests = 1
                mock_settings.headless = True
                await pool.initialize()

        ctx = await pool.acquire()
        await pool.release(ctx)

        # Should be able to acquire again (semaphore was released)
        ctx2 = await pool.acquire()
        assert ctx2 is not None

    @pytest.mark.asyncio
    async def test_acquire_releases_semaphore_on_context_error(self, pool):
        mock_pw, mock_browser, _ = _mock_playwright()
        mock_browser.new_context = AsyncMock(side_effect=RuntimeError("context failed"))

        with patch("app.services.browser_pool.async_playwright") as mock_apw:
            mock_apw.return_value.start = AsyncMock(return_value=mock_pw)
            with patch("app.services.browser_pool.settings") as mock_settings:
                mock_settings.max_concurrent_requests = 1
                mock_settings.headless = True
                await pool.initialize()

        with pytest.raises(RuntimeError, match="context failed"):
            await pool.acquire()

        # Semaphore should be released - set browser to succeed now
        mock_browser.new_context = AsyncMock(return_value=AsyncMock())
        ctx = await pool.acquire()
        assert ctx is not None


class TestConcurrency:
    @pytest.mark.asyncio
    async def test_semaphore_limits_concurrent_contexts(self, pool):
        mock_pw, mock_browser, _ = _mock_playwright()
        mock_browser.new_context = AsyncMock(side_effect=lambda **kwargs: AsyncMock())

        with patch("app.services.browser_pool.async_playwright") as mock_apw:
            mock_apw.return_value.start = AsyncMock(return_value=mock_pw)
            with patch("app.services.browser_pool.settings") as mock_settings:
                mock_settings.max_concurrent_requests = 2
                mock_settings.headless = True
                await pool.initialize()

        ctx1 = await pool.acquire()
        ctx2 = await pool.acquire()

        # Third acquire should block (timeout to prove it blocks)
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(pool.acquire(), timeout=0.1)

        # Release one, now third should succeed
        await pool.release(ctx1)
        ctx3 = await pool.acquire()
        assert ctx3 is not None
        await pool.release(ctx2)
        await pool.release(ctx3)


class TestShutdown:
    @pytest.mark.asyncio
    async def test_shutdown_closes_browser_and_playwright(self, pool):
        mock_pw, mock_browser, _ = _mock_playwright()

        with patch("app.services.browser_pool.async_playwright") as mock_apw:
            mock_apw.return_value.start = AsyncMock(return_value=mock_pw)
            await pool.initialize()

        await pool.shutdown()
        assert not pool.initialized
        mock_browser.close.assert_awaited_once()
        mock_pw.stop.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_shutdown_handles_errors_gracefully(self, pool):
        mock_pw, mock_browser, _ = _mock_playwright()
        mock_browser.close = AsyncMock(side_effect=RuntimeError("close error"))
        mock_pw.stop = AsyncMock(side_effect=RuntimeError("stop error"))

        with patch("app.services.browser_pool.async_playwright") as mock_apw:
            mock_apw.return_value.start = AsyncMock(return_value=mock_pw)
            await pool.initialize()

        await pool.shutdown()
        assert not pool.initialized

"""
Crawl4AI service for website crawling and content extraction.

This service uses Crawl4AI to:
1. Detect if a URL is a website (vs a single document)
2. Discover all URLs on the website using sitemaps/Common Crawl
3. Crawl and extract content from discovered pages
4. Return structured content for ingestion
"""

import asyncio
import fnmatch
import gc
import logging
from typing import Any
from urllib.parse import urlparse

logger = logging.getLogger(__name__)


def _cleanup_memory():
    """Force Python garbage collection to free memory after crawl tasks."""
    collected = gc.collect()
    logger.debug(f"Garbage collection freed {collected} objects")


class CrawlerService:
    """Service for crawling websites using Crawl4AI."""

    def __init__(self, crawl_count_before_restart: int = 25):
        self.initialized = False
        self._crawler = None
        self._crawl_count = 0
        self._crawl_count_before_restart = crawl_count_before_restart
        self._restart_lock = asyncio.Lock()

    async def initialize(self):
        """Initialize Crawl4AI components."""
        if self.initialized:
            return

        # Import here to avoid issues if crawl4ai is not installed
        try:
            from crawl4ai import AsyncWebCrawler, BrowserConfig
        except ImportError as e:
            logger.error(f"Failed to import crawl4ai: {e}")
            raise RuntimeError("crawl4ai is not installed. Install with: pip install crawl4ai") from e

        browser_config = BrowserConfig(
            extra_args=[
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--no-zygote",
                "--disable-breakpad",
                "--disable-crash-reporter",
            ],
        )
        self._crawler = AsyncWebCrawler(config=browser_config)
        await self._crawler.__aenter__()

        self.initialized = True
        self._crawl_count = 0
        logger.info("Crawl4AI service initialized successfully")

    async def _maybe_restart_browser(self):
        """Restart the browser if crawl count exceeds threshold to prevent memory leaks."""
        async with self._restart_lock:
            if self._crawl_count >= self._crawl_count_before_restart:
                logger.info(
                    f"Crawl count ({self._crawl_count}) reached threshold "
                    f"({self._crawl_count_before_restart}), restarting browser..."
                )
                await self.cleanup()
                await self.initialize()
                logger.info("Browser restarted successfully")

    def _increment_crawl_count(self, count: int = 1):
        """Increment the crawl count."""
        self._crawl_count += count
        logger.debug(f"Crawl count: {self._crawl_count}")

    async def cleanup(self):
        """Cleanup Crawl4AI resources."""
        if not self.initialized:
            return

        try:
            if self._crawler:
                await self._crawler.__aexit__(None, None, None)
            logger.info("Crawl4AI service cleaned up successfully")
        except Exception as e:
            logger.error(f"Error during Crawl4AI cleanup: {e}")
        finally:
            self.initialized = False
            self._crawler = None

    def is_website_url(self, url: str) -> bool:
        """
        Determine if a URL points to a website (vs a single document).

        A URL is considered a website if:
        1. It has no file extension, OR
        2. It has a common web extension (.html, .htm, .php, .asp, .aspx, .jsp)

        Returns:
            True if the URL is a website, False if it's a single document
        """
        parsed = urlparse(url)
        path = parsed.path.lower()

        # If path is empty or ends with /, it's a website
        if not path or path.endswith("/"):
            return True

        # Check for file extension
        if "." in path.split("/")[-1]:
            # Common web extensions that indicate a website
            web_extensions = {".html", ".htm", ".php", ".asp", ".aspx", ".jsp"}
            # Document extensions that indicate a single file
            doc_extensions = {
                ".pdf",
                ".doc",
                ".docx",
                ".txt",
                ".md",
                ".json",
                ".xml",
                ".csv",
            }

            ext = "." + path.split(".")[-1]

            if ext in web_extensions:
                return True
            return ext not in doc_extensions

        # No extension - assume it's a website
        return True

    def _extract_structured_data_from_html(self, html: str) -> dict[str, Any]:
        """
        Extract structured data from HTML content.

        Extracts:
        - Price information (from OpenGraph, meta tags, JSON-LD)
        - Product information
        - Images
        - Other structured data

        Args:
            html: HTML content from crawler

        Returns:
            Dictionary with structured data
        """
        import json as json_lib

        from bs4 import BeautifulSoup

        structured = {}

        try:
            logger.info(f"Extracting structured data from HTML (length: {len(html)} chars)")
            soup = BeautifulSoup(html, "html.parser")

            # Extract OpenGraph data (common for e-commerce)
            og_data = {}

            # Find all meta tags with property starting with "og:"
            og_tags = soup.find_all("meta", property=lambda x: x and x.startswith("og:"))
            logger.info(f"Found {len(og_tags)} OpenGraph tags")
            for tag in og_tags:
                prop = tag.get("property", "").replace("og:", "")
                content = tag.get("content", "")
                if content:
                    og_data[prop] = content
                    logger.info(f"  - {prop}: {content[:100]}")

            if og_data:
                structured["opengraph"] = og_data

            # Extract JSON-LD structured data
            json_ld_scripts = soup.find_all("script", type="application/ld+json")
            json_ld_data = []
            for script in json_ld_scripts:
                try:
                    data = json_lib.loads(script.string)
                    json_ld_data.append(data)
                except (json_lib.JSONDecodeError, TypeError):
                    pass

            if json_ld_data:
                structured["json_ld"] = json_ld_data

            # Extract other common meta tags
            meta_tags = {}
            for name in ["description", "keywords", "author"]:
                tag = soup.find("meta", attrs={"name": name})
                if tag and tag.get("content"):
                    meta_tags[name] = tag.get("content")

            if meta_tags:
                structured["meta"] = meta_tags

        except Exception as e:
            logger.warning(f"Failed to extract structured data from HTML: {e}")

        return structured

    async def discover_urls(
        self,
        domain: str,
        max_urls: int = 100,
        pattern: str | None = None,
        query: str | None = None,
        timeout: float = 1800.0,
        extract_head: bool = False,
    ) -> list[dict[str, Any]]:
        """
        Discover all URLs on a website using sitemap parsing.

        Uses ultimate-sitemap-parser instead of crawl4ai's AsyncUrlSeeder because
        the latter has two bugs that cause silent failures on many real-world sites:

        1. HEAD/GET inconsistency: AsyncUrlSeeder probes sitemap existence with HEAD
           requests, but some servers (e.g. legacy CMS) return different status codes
           for HEAD vs GET on the same URL (HEAD -> 301 -> 404, GET -> 301 -> 200).
           This causes sitemap detection to fail even when the sitemap is accessible.

        2. Double gzip decompression: When a .xml.gz sitemap is served with
           Content-Encoding: gzip, httpx auto-decompresses the transport layer.
           AsyncUrlSeeder then tries gzip.decompress() again based on the .gz file
           extension, which fails silently and returns 0 URLs.

        ultimate-sitemap-parser handles both cases gracefully — it uses GET requests
        throughout and falls back to raw XML parsing when gunzip fails.

        Args:
            domain: The domain to discover URLs from (e.g., "docs.example.com")
            max_urls: Maximum number of URLs to discover (-1 for unlimited)
            pattern: Optional URL pattern filter (e.g., "*/docs/*")
            query: Unused, kept for API compatibility
            timeout: Timeout in seconds for URL discovery (default: 1800 seconds / 30 minutes)
            extract_head: Unused, kept for API compatibility

        Returns:
            List of discovered URLs with metadata
        """
        from usp.tree import sitemap_tree_for_homepage

        homepage = f"https://{domain}/"
        logger.info(f"Discovering URLs from {domain} using ultimate-sitemap-parser...")

        def _discover():
            tree = sitemap_tree_for_homepage(homepage)
            urls = []
            for page in tree.all_pages():
                if 0 < max_urls <= len(urls):
                    break
                url = page.url
                if pattern and not fnmatch.fnmatch(url, pattern):
                    continue
                urls.append({"url": url})
            return urls

        urls = await asyncio.wait_for(
            asyncio.to_thread(_discover),
            timeout=timeout,
        )

        logger.info(f"Discovered {len(urls)} URLs from {domain}")
        _cleanup_memory()
        return urls

    async def crawl_urls(
        self,
        urls: list[str],
        word_count_threshold: int = 100,
    ) -> list[dict[str, Any]]:
        """
        Crawl multiple URLs and extract their content.

        Args:
            urls: List of URLs to crawl
            word_count_threshold: Minimum word count for content

        Returns:
            List of crawled pages with content
        """
        if not self.initialized:
            await self.initialize()

        from crawl4ai import CrawlerRunConfig
        from crawl4ai.content_filter_strategy import PruningContentFilter
        from crawl4ai.markdown_generation_strategy import DefaultMarkdownGenerator

        config = CrawlerRunConfig(
            only_text=False,  # We need HTML to extract structured data
            word_count_threshold=word_count_threshold,
            stream=True,
            # Memory optimization: disable caching to reduce memory footprint
            cache_mode="bypass",
            # Disable screenshot capture to save memory
            screenshot=False,
            pdf=False,
            # Exclude structural/navigational HTML elements to reduce noise in markdown
            excluded_tags=["nav", "footer", "header", "aside", "select", "option"],
            exclude_external_links=True,
            exclude_social_media_links=True,
            # Use PruningContentFilter for fit_markdown: density-based main content extraction
            markdown_generator=DefaultMarkdownGenerator(
                content_filter=PruningContentFilter(threshold=0.4),
                options={"ignore_links": True},
            ),
        )

        logger.info(f"Crawling {len(urls)} URLs...")
        results = []

        try:
            async for result in await self._crawler.arun_many(urls, config=config):
                if result.success:
                    if result.status_code is not None and result.status_code >= 400:
                        logger.warning(f"HTTP error for {result.url}: {result.status_code}")
                        results.append(
                            {
                                "url": result.url,
                                "status_code": result.status_code,
                                "content": None,
                            }
                        )
                        continue

                    # Prefer fit_markdown (density-filtered main content) over raw_markdown
                    markdown_content = result.markdown.fit_markdown or result.markdown.raw_markdown

                    # Extract structured data (price, images, etc.) from HTML
                    structured_data = self._extract_structured_data_from_html(result.html)
                    logger.info(f"Structured data extracted: {structured_data}")

                    results.append(
                        {
                            "url": result.url,
                            "status_code": result.status_code,
                            "title": result.metadata.get("title"),
                            "content": markdown_content,
                            "word_count": len(markdown_content.split()),
                            "metadata": result.metadata,
                            "structured_data": structured_data,
                        }
                    )
                    logger.info(f"Added result with structured_data: {results[-1].get('structured_data')}")
                else:
                    logger.warning(f"Failed to crawl {result.url}: {result.error_message}")

            logger.info(f"Successfully crawled {len(results)} pages")
        finally:
            # Always cleanup memory after crawl task, even on error
            _cleanup_memory()

            # Track crawl count and maybe restart browser to prevent memory leaks
            self._increment_crawl_count(len(urls))
            await self._maybe_restart_browser()

        return results

    async def crawl_single_url(
        self,
        url: str,
        word_count_threshold: int = 10,
        timeout: float = 60.0,
    ) -> dict[str, Any]:
        """Crawl a single URL and return rich content including media metadata.

        Unlike crawl_urls() which is optimized for batch website scanning,
        this method returns additional data (media images) useful for
        single-page content extraction.

        Args:
            url: URL to crawl
            word_count_threshold: Minimum word count for content
            timeout: Timeout in seconds for the crawl operation

        Returns:
            Dictionary with url, title, content, word_count, metadata,
            structured_data, and media_images

        Raises:
            TimeoutError: If crawl exceeds timeout
            RuntimeError: If crawl fails
        """
        if not self.initialized:
            await self.initialize()

        from crawl4ai import CrawlerRunConfig
        from crawl4ai.content_filter_strategy import PruningContentFilter
        from crawl4ai.markdown_generation_strategy import DefaultMarkdownGenerator

        config = CrawlerRunConfig(
            only_text=False,
            word_count_threshold=word_count_threshold,
            cache_mode="bypass",
            screenshot=False,
            pdf=False,
            excluded_tags=["nav", "footer", "header", "aside", "select", "option"],
            exclude_social_media_links=True,
            markdown_generator=DefaultMarkdownGenerator(
                content_filter=PruningContentFilter(threshold=0.4),
            ),
        )

        logger.info(f"Crawling single URL: {url}")

        try:
            result = await asyncio.wait_for(
                self._crawler.arun(url=url, config=config),
                timeout=timeout,
            )

            if not result.success:
                raise RuntimeError(f"Failed to crawl {url}: {result.error_message}")

            if result.status_code is not None and result.status_code >= 400:
                raise RuntimeError(f"Failed to crawl {url}: HTTP {result.status_code}")

            markdown_content = result.markdown.fit_markdown or result.markdown.raw_markdown
            structured_data = self._extract_structured_data_from_html(result.html)
            media_images = result.media.get("images", []) if result.media else []

            logger.info(f"Single URL crawled: {len(markdown_content.split())} words, {len(media_images)} images found")

            return {
                "url": result.url,
                "title": result.metadata.get("title") if result.metadata else None,
                "content": markdown_content,
                "word_count": len(markdown_content.split()),
                "metadata": result.metadata,
                "structured_data": structured_data,
                "media_images": media_images,
            }
        finally:
            _cleanup_memory()
            self._increment_crawl_count(1)
            await self._maybe_restart_browser()


# Global service instance
_crawler_service: CrawlerService | None = None


def get_crawler_service(crawl_count_before_restart: int = 25) -> CrawlerService:
    """Get or create the global Crawler service instance."""
    global _crawler_service
    if _crawler_service is None:
        _crawler_service = CrawlerService(crawl_count_before_restart=crawl_count_before_restart)
    return _crawler_service

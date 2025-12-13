"""
Crawl4AI service for website crawling and content extraction.

This service uses Crawl4AI to:
1. Detect if a URL is a website (vs a single document)
2. Discover all URLs on the website using sitemaps/Common Crawl
3. Crawl and extract content from discovered pages
4. Return structured content for ingestion
"""

import gc
import logging
from typing import Dict, Any, List, Optional
from urllib.parse import urlparse
import asyncio

logger = logging.getLogger(__name__)


def _cleanup_memory():
    """Force Python garbage collection to free memory after crawl tasks."""
    collected = gc.collect()
    logger.debug(f"Garbage collection freed {collected} objects")


class CrawlerService:
    """Service for crawling websites using Crawl4AI."""

    # Restart browser after this many crawl operations to prevent memory leaks
    CRAWL_COUNT_BEFORE_RESTART = 50

    def __init__(self):
        self.initialized = False
        self._seeder = None
        self._crawler = None
        self._crawl_count = 0
        self._restart_lock = asyncio.Lock()

    async def initialize(self):
        """Initialize Crawl4AI components."""
        if self.initialized:
            return

        # Import here to avoid issues if crawl4ai is not installed
        try:
            from crawl4ai import AsyncUrlSeeder, AsyncWebCrawler
        except ImportError as e:
            logger.error(f"Failed to import crawl4ai: {e}")
            raise RuntimeError(
                "crawl4ai is not installed. Install with: pip install crawl4ai"
            ) from e

        self._seeder = AsyncUrlSeeder()
        self._crawler = AsyncWebCrawler()

        # Initialize the seeder and crawler
        await self._seeder.__aenter__()
        await self._crawler.__aenter__()

        self.initialized = True
        self._crawl_count = 0
        logger.info("Crawl4AI service initialized successfully")

    async def _maybe_restart_browser(self):
        """Restart the browser if crawl count exceeds threshold to prevent memory leaks."""
        async with self._restart_lock:
            if self._crawl_count >= self.CRAWL_COUNT_BEFORE_RESTART:
                logger.info(
                    f"Crawl count ({self._crawl_count}) reached threshold "
                    f"({self.CRAWL_COUNT_BEFORE_RESTART}), restarting browser..."
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
            if self._seeder:
                await self._seeder.__aexit__(None, None, None)
            if self._crawler:
                await self._crawler.__aexit__(None, None, None)
            logger.info("Crawl4AI service cleaned up successfully")
        except Exception as e:
            logger.error(f"Error during Crawl4AI cleanup: {e}")
        finally:
            self.initialized = False
            self._seeder = None
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
            if ext in doc_extensions:
                return False

            # Unknown extension - assume it's a website
            return True

        # No extension - assume it's a website
        return True

    def _extract_structured_data_from_html(self, html: str) -> Dict[str, Any]:
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
        from bs4 import BeautifulSoup
        import json as json_lib

        structured = {}

        try:
            logger.info(f"Extracting structured data from HTML (length: {len(html)} chars)")
            soup = BeautifulSoup(html, 'html.parser')

            # Extract OpenGraph data (common for e-commerce)
            og_data = {}

            # Find all meta tags with property starting with "og:"
            og_tags = soup.find_all('meta', property=lambda x: x and x.startswith('og:'))
            logger.info(f"Found {len(og_tags)} OpenGraph tags")
            for tag in og_tags:
                prop = tag.get('property', '').replace('og:', '')
                content = tag.get('content', '')
                if content:
                    og_data[prop] = content
                    logger.info(f"  - {prop}: {content[:100]}")

            if og_data:
                structured["opengraph"] = og_data

            # Extract JSON-LD structured data
            json_ld_scripts = soup.find_all('script', type='application/ld+json')
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
            for name in ['description', 'keywords', 'author']:
                tag = soup.find('meta', attrs={'name': name})
                if tag and tag.get('content'):
                    meta_tags[name] = tag.get('content')

            if meta_tags:
                structured["meta"] = meta_tags

        except Exception as e:
            logger.warning(f"Failed to extract structured data from HTML: {e}")

        return structured

    async def discover_urls(
        self,
        domain: str,
        max_urls: int = 100,
        pattern: Optional[str] = None,
        query: Optional[str] = None,
        timeout: float = 1800.0,
    ) -> List[Dict[str, Any]]:
        """
        Discover all URLs on a website using sitemaps and Common Crawl.

        Args:
            domain: The domain to discover URLs from (e.g., "docs.example.com")
            max_urls: Maximum number of URLs to discover (-1 for unlimited)
            pattern: Optional URL pattern filter (e.g., "*/docs/*")
            query: Optional search query for BM25 scoring
            timeout: Timeout in seconds for URL discovery (default: 1800 seconds / 30 minutes)

        Returns:
            List of discovered URLs with metadata
        """
        if not self.initialized:
            await self.initialize()

        from crawl4ai import SeedingConfig

        # Try with sitemap+cc first, then fallback to sitemap-only if Common Crawl fails.
        # We also rate-limit discovery to avoid hammering sites and triggering 429s.
        sources_to_try = ["sitemap+cc", "sitemap"]

        for source in sources_to_try:
            try:
                # Configure URL discovery
                config = SeedingConfig(
                    source=source,
                    extract_head=True,  # Get metadata for filtering
                    max_urls=max_urls if max_urls > 0 else -1,
                    filter_nonsense_urls=True,  # Skip robots.txt, .js, .css, etc.
                    pattern=pattern,
                    query=query,
                    scoring_method="bm25" if query else None,
                    score_threshold=0.3 if query else None,
                    concurrency=3,  # Be polite to target sites
                    hits_per_sec=1,  # Explicit rate limit to reduce 429s
                    verbose=True,
                )

                logger.info(
                    f"Discovering URLs from {domain} using source: {source} "
                    f"with timeout: {timeout}s..."
                )

                # Add timeout to prevent hanging
                urls = await asyncio.wait_for(
                    self._seeder.urls(domain, config),
                    timeout=timeout,
                )

                logger.info(
                    f"Seeder returned {len(urls)} URLs for {domain} from source {source}"
                )

                # Keep all URLs returned by the seeder; let the crawler handle transient failures.
                filtered_urls = urls

                logger.info(
                    "Discovered %s URLs from %s (no additional filtering applied)",
                    len(filtered_urls),
                    domain,
                )

                # Cleanup memory after discovery
                _cleanup_memory()

                return filtered_urls

            except asyncio.TimeoutError:
                logger.warning(f"Timeout discovering URLs with source '{source}', trying next source...")
                _cleanup_memory()
                if source == sources_to_try[-1]:
                    raise Exception(f"All discovery sources timed out for {domain}")
                continue

            except Exception as e:
                logger.warning(f"Error discovering URLs with source '{source}': {e}")
                _cleanup_memory()
                if source == sources_to_try[-1]:
                    raise Exception(f"Failed to discover URLs from {domain}: {str(e)}")
                continue

        _cleanup_memory()
        return []

    async def crawl_urls(
        self,
        urls: List[str],
        word_count_threshold: int = 100,
    ) -> List[Dict[str, Any]]:
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

        config = CrawlerRunConfig(
            only_text=False,  # We need HTML to extract structured data
            word_count_threshold=word_count_threshold,
            stream=True,
            # Memory optimization: disable caching to reduce memory footprint
            cache_mode="bypass",
            # Disable screenshot capture to save memory
            screenshot=False,
            pdf=False,
        )

        logger.info(f"Crawling {len(urls)} URLs...")
        results = []

        try:
            async for result in await self._crawler.arun_many(urls, config=config):
                if result.success:
                    # Use the new 'markdown' attribute instead of deprecated 'markdown_v2'
                    markdown_content = result.markdown.raw_markdown

                    # Extract structured data (price, images, etc.) from HTML
                    structured_data = self._extract_structured_data_from_html(result.html)
                    logger.info(f"Structured data extracted: {structured_data}")

                    results.append(
                        {
                            "url": result.url,
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

# Global service instance
_crawler_service: Optional[CrawlerService] = None


def get_crawler_service() -> CrawlerService:
    """Get or create the global Crawler service instance."""
    global _crawler_service
    if _crawler_service is None:
        _crawler_service = CrawlerService()
    return _crawler_service


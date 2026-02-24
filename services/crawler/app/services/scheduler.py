"""
Background scheduler for autonomous website scanning.

Periodically checks for websites due for scanning and runs discovery + content
hashing in parallel (bounded by Semaphore). Each website writes to its own
SQLite file so there is zero lock contention between concurrent scans.
"""

import asyncio
import hashlib
import json
import logging
import time

from app.services.crawler_service import CrawlerService
from app.services.website_store import WebsiteStoreManager

logger = logging.getLogger(__name__)

MAX_CONCURRENT_SCANS = 3
CRAWL_BATCH_SIZE = 20
POLL_INTERVAL = 60  # seconds

_scan_trigger: asyncio.Event | None = None


def _sha256(content: str) -> str:
    return hashlib.sha256(content.encode()).hexdigest()


def trigger_scan():
    """Wake the scheduler immediately (e.g. after a new website registration)."""
    if _scan_trigger is not None:
        _scan_trigger.set()


async def run_scheduler(
    store_manager: WebsiteStoreManager,
    crawler_service: CrawlerService,
):
    global _scan_trigger
    _scan_trigger = asyncio.Event()

    sem = asyncio.Semaphore(MAX_CONCURRENT_SCANS)

    async def bounded_scan(domain: str):
        async with sem:
            await _scan_website(domain, store_manager, crawler_service)

    while True:
        try:
            due = store_manager.get_due_websites()
            if due:
                logger.info(f"Scheduler: {len(due)} website(s) due for scanning")
                tasks = [asyncio.create_task(bounded_scan(w["domain"])) for w in due]
                await asyncio.gather(*tasks, return_exceptions=True)
        except Exception:
            logger.exception("Scheduler loop error")

        _scan_trigger.clear()
        try:
            await asyncio.wait_for(_scan_trigger.wait(), timeout=POLL_INTERVAL)
            logger.info("Scheduler: woke up via trigger")
        except TimeoutError:
            pass


async def _scan_website(
    domain: str,
    store_manager: WebsiteStoreManager,
    crawler_service: CrawlerService,
):
    site_store = store_manager.get_site_store(domain)
    store_manager.update_scan_status(domain, "scanning")

    try:
        if not crawler_service.initialized:
            await crawler_service.initialize()

        # Phase 1: Discover new URLs
        logger.info(f"Scan [{domain}]: Phase 1 — discovering URLs")
        discovered = await crawler_service.discover_urls(domain=domain, max_urls=-1)
        site_store.save_discovered_urls(discovered)
        logger.info(f"Scan [{domain}]: discovered {len(discovered)} URLs")

        # Phase 2: Crawl URLs in batches and cache content + hashes
        scan_start = time.time()
        crawled_total = 0
        while True:
            to_crawl = site_store.get_urls_needing_recrawl(limit=CRAWL_BATCH_SIZE, crawled_before=scan_start)
            if not to_crawl:
                break

            logger.info(
                f"Scan [{domain}]: Phase 2 — crawling batch of {len(to_crawl)} URLs (total so far: {crawled_total})"
            )
            results = await crawler_service.crawl_urls(urls=to_crawl)
            succeeded_urls = {p["url"] for p in results}
            failed_urls = [u for u in to_crawl if u not in succeeded_urls]

            updates = [
                {
                    "url": p["url"],
                    "content_hash": _sha256(p["content"]),
                    "status": "active",
                    "title": p.get("title"),
                    "content": p["content"],
                    "word_count": p.get("word_count", 0),
                    "metadata": json.dumps(p.get("metadata")) if p.get("metadata") else None,
                    "structured_data": json.dumps(p.get("structured_data")) if p.get("structured_data") else None,
                }
                for p in results
            ]
            site_store.update_content_hashes(updates)
            crawled_total += len(updates)

            if failed_urls:
                logger.warning(f"Scan [{domain}]: {len(failed_urls)} URLs failed in batch")
                site_store.increment_fail_count(failed_urls)

        logger.info(f"Scan [{domain}]: crawled {crawled_total} URLs total")

        store_manager.update_last_scanned(domain)
        store_manager.update_scan_status(domain, "idle")
        logger.info(f"Scan [{domain}]: complete")

    except Exception as e:
        logger.exception(f"Scan failed for {domain}")
        store_manager.update_scan_status(domain, "error", str(e))

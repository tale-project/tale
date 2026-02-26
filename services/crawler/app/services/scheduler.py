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

import httpx

from app.services.crawler_service import CrawlerService
from app.services.website_store import WebsiteStore, WebsiteStoreManager

logger = logging.getLogger(__name__)

MAX_CONCURRENT_SCANS = 2
CRAWL_BATCH_SIZE = 10
POLL_INTERVAL = 60  # seconds
_HEAD_TIMEOUT = 10
_HEAD_CONCURRENCY = 5

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


async def _head_check(
    urls: list[str],
    site_store: WebsiteStore,
) -> tuple[list[str], list[str]]:
    """Split URLs into (unchanged, needs_crawl) using conditional HEAD requests."""
    stored = site_store.get_cache_headers(urls)

    urls_with_headers = [u for u in urls if u in stored]
    urls_without_headers = [u for u in urls if u not in stored]

    if not urls_with_headers:
        return [], urls

    unchanged: list[str] = []
    needs_crawl: list[str] = list(urls_without_headers)
    header_updates: list[dict] = []
    sem = asyncio.Semaphore(_HEAD_CONCURRENCY)

    async def check_one(client: httpx.AsyncClient, url: str):
        headers_to_send: dict[str, str] = {}
        cached = stored[url]
        if cached["etag"]:
            headers_to_send["If-None-Match"] = cached["etag"]
        if cached["last_modified"]:
            headers_to_send["If-Modified-Since"] = cached["last_modified"]

        async with sem:
            try:
                resp = await client.head(url, headers=headers_to_send)
                if resp.status_code == 304:
                    unchanged.append(url)
                else:
                    needs_crawl.append(url)
                    new_etag = resp.headers.get("etag")
                    new_lm = resp.headers.get("last-modified")
                    if new_etag or new_lm:
                        header_updates.append({"url": url, "etag": new_etag, "last_modified": new_lm})
            except Exception:
                needs_crawl.append(url)

    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=_HEAD_TIMEOUT,
        verify=False,
    ) as client:
        await asyncio.gather(*[check_one(client, u) for u in urls_with_headers])

    if header_updates:
        site_store.update_cache_headers(header_updates)

    return unchanged, needs_crawl


async def _seed_cache_headers(
    urls: list[str],
    site_store: WebsiteStore,
) -> None:
    """Seed etag/last_modified via HEAD for URLs that just completed their first crawl."""
    sem = asyncio.Semaphore(_HEAD_CONCURRENCY)
    header_updates: list[dict] = []

    async def seed_one(client: httpx.AsyncClient, url: str):
        async with sem:
            try:
                resp = await client.head(url)
                etag = resp.headers.get("etag")
                last_modified = resp.headers.get("last-modified")
                if etag or last_modified:
                    header_updates.append({"url": url, "etag": etag, "last_modified": last_modified})
            except Exception:
                pass

    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=_HEAD_TIMEOUT,
        verify=False,
    ) as client:
        await asyncio.gather(*[seed_one(client, u) for u in urls])

    if header_updates:
        site_store.update_cache_headers(header_updates)
        logger.info(f"Seeded cache headers for {len(header_updates)}/{len(urls)} URLs")


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
        skipped_total = 0
        while True:
            batch = site_store.get_urls_needing_recrawl(limit=CRAWL_BATCH_SIZE, crawled_before=scan_start)
            if not batch:
                break

            # Pre-flight: skip URLs unchanged since last crawl (304)
            had_headers = site_store.get_cache_headers(batch)
            unchanged, to_crawl = await _head_check(batch, site_store)
            if unchanged:
                site_store.touch_crawled_at(unchanged)
                skipped_total += len(unchanged)

            if not to_crawl:
                continue

            logger.info(
                f"Scan [{domain}]: Phase 2 — crawling {len(to_crawl)} URLs "
                f"(skipped {len(unchanged)}, total so far: {crawled_total})"
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

            # Seed cache headers for URLs that had none before
            first_time = [u for u in succeeded_urls if u not in had_headers]
            if first_time:
                await _seed_cache_headers(first_time, site_store)

        logger.info(f"Scan [{domain}]: crawled {crawled_total}, skipped {skipped_total} unchanged URLs")

        store_manager.update_last_scanned(domain)
        store_manager.update_scan_status(domain, "idle")
        logger.info(f"Scan [{domain}]: complete")

    except Exception as e:
        logger.exception(f"Scan failed for {domain}")
        store_manager.update_scan_status(domain, "error", str(e))

"""
Background scheduler for autonomous website scanning.

Periodically checks for websites due for scanning and runs discovery + content
hashing in parallel (bounded by Semaphore).
"""

import asyncio
import hashlib

import logging
import time

import httpx

from app.services.crawler_service import CrawlerService
from app.services.indexing_service import IndexingService
from app.services.pg_website_store import PgWebsiteStore, PgWebsiteStoreManager
from app.utils.metadata import extract_meta_description
from app.utils.structured_data import format_structured_data

logger = logging.getLogger(__name__)

_HEAD_TIMEOUT = 10
_HEAD_CONCURRENCY = 5
_HEAD_BATCH_SIZE = 50
_PERMANENT_HTTP_ERRORS = {404, 410}
_MAX_DELETION_RATIO = 0.5
_MAX_FAIL_COUNT = 10

_scan_trigger: asyncio.Event | None = None
_cancelled_domains: set[str] = set()


def _sha256(content: str) -> str:
    return hashlib.sha256(content.encode()).hexdigest()


def trigger_scan():
    """Wake the scheduler immediately (e.g. after a new website registration)."""
    if _scan_trigger is not None:
        _scan_trigger.set()


def cancel_scan(domain: str):
    """Mark a domain for scan cancellation."""
    _cancelled_domains.add(domain)


def _is_cancelled(domain: str) -> bool:
    return domain in _cancelled_domains


def _clear_cancelled(domain: str):
    _cancelled_domains.discard(domain)


async def run_scheduler(
    store_manager: PgWebsiteStoreManager,
    crawler_service: CrawlerService,
    indexing_service: IndexingService | None = None,
    *,
    max_concurrent_scans: int = 1,
    poll_interval: int = 300,
    crawl_batch_size: int = 5,
):
    global _scan_trigger
    _scan_trigger = asyncio.Event()

    sem = asyncio.Semaphore(max_concurrent_scans)

    async def bounded_scan(domain: str):
        async with sem:
            await _scan_website(domain, store_manager, crawler_service, indexing_service, crawl_batch_size)

    while True:
        try:
            due = await store_manager.get_due_websites()
            if due:
                logger.info(f"Scheduler: {len(due)} website(s) due for scanning")
                tasks = [asyncio.create_task(bounded_scan(w["domain"])) for w in due]
                results = await asyncio.gather(*tasks, return_exceptions=True)
                for website, result in zip(due, results, strict=True):
                    if isinstance(result, BaseException):
                        logger.error(f"Scheduler: scan failed for {website['domain']}: {result}")
                        try:
                            await store_manager.update_scan_status(website["domain"], "error", str(result))
                        except Exception:
                            logger.exception(f"Scheduler: failed to update error status for {website['domain']}")
        except Exception:
            logger.exception("Scheduler loop error")

        _scan_trigger.clear()
        try:
            await asyncio.wait_for(_scan_trigger.wait(), timeout=poll_interval)
            logger.info("Scheduler: woke up via trigger")
        except TimeoutError:
            pass


async def _head_check(
    urls: list[str],
    site_store: PgWebsiteStore,
) -> tuple[list[str], list[str]]:
    """Split URLs into (unchanged, needs_crawl) using conditional HEAD requests."""
    stored = await site_store.get_cache_headers(urls)

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
        verify=False,  # Intentional: crawling arbitrary external sites that may have invalid certs
    ) as client:
        await asyncio.gather(*[check_one(client, u) for u in urls_with_headers])

    if header_updates:
        await site_store.update_cache_headers(header_updates)

    return unchanged, needs_crawl


async def _seed_cache_headers(
    urls: list[str],
    site_store: PgWebsiteStore,
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
        verify=False,  # Intentional: crawling arbitrary external sites that may have invalid certs
    ) as client:
        await asyncio.gather(*[seed_one(client, u) for u in urls])

    if header_updates:
        await site_store.update_cache_headers(header_updates)
        logger.info(f"Seeded cache headers for {len(header_updates)}/{len(urls)} URLs")


def _is_homepage(url: str, domain: str) -> bool:
    """Check if a URL is the homepage (root path) of the domain."""
    from urllib.parse import urlparse

    parsed = urlparse(url)
    return parsed.netloc == domain and parsed.path in ("", "/")


async def _bulk_head_check(
    all_urls: list[str],
    site_store: PgWebsiteStore,
) -> tuple[list[str], list[str], set[str]]:
    """HEAD check all URLs in batches, return (unchanged, needs_crawl, urls_with_prior_headers)."""
    all_unchanged: list[str] = []
    all_needs_crawl: list[str] = []
    all_had_headers: set[str] = set()

    for i in range(0, len(all_urls), _HEAD_BATCH_SIZE):
        batch = all_urls[i : i + _HEAD_BATCH_SIZE]
        had_headers = await site_store.get_cache_headers(batch)
        all_had_headers.update(had_headers)
        unchanged, needs_crawl = await _head_check(batch, site_store)
        all_unchanged.extend(unchanged)
        all_needs_crawl.extend(needs_crawl)

    return all_unchanged, all_needs_crawl, all_had_headers


async def _scan_website(
    domain: str,
    store_manager: PgWebsiteStoreManager,
    crawler_service: CrawlerService,
    indexing_service: IndexingService | None = None,
    crawl_batch_size: int = 5,
):
    _clear_cancelled(domain)
    site_store = store_manager.get_site_store(domain)
    await store_manager.update_scan_status(domain, "scanning")
    await store_manager.update_last_scanned(domain)

    try:
        if not crawler_service.initialized:
            await crawler_service.initialize()

        # Phase 1: Discover new URLs
        if _is_cancelled(domain):
            logger.info(f"Scan [{domain}]: cancelled before discovery")
            await store_manager.update_scan_status(domain, "idle")
            return
        logger.info(f"Scan [{domain}]: Phase 1 — discovering URLs")
        discovered = await crawler_service.discover_urls(domain=domain, max_urls=-1)
        await site_store.save_discovered_urls(discovered)
        logger.info(f"Scan [{domain}]: discovered {len(discovered)} URLs")

        # Phase 2: Bulk HEAD check — filter unchanged URLs up front
        if _is_cancelled(domain):
            logger.info(f"Scan [{domain}]: cancelled before HEAD check")
            await store_manager.update_scan_status(domain, "idle")
            return
        scan_start = time.time()
        all_urls = await site_store.get_urls_needing_recrawl(
            limit=10000, crawled_before=scan_start, max_fail_count=_MAX_FAIL_COUNT
        )
        if not all_urls:
            logger.info(f"Scan [{domain}]: no URLs need recrawling")
            await store_manager.update_last_scanned(domain)
            await store_manager.update_scan_status(domain, "active")
            return

        logger.info(f"Scan [{domain}]: Phase 2 — HEAD checking {len(all_urls)} URLs in batches of {_HEAD_BATCH_SIZE}")
        unchanged, needs_crawl, had_headers = await _bulk_head_check(all_urls, site_store)

        if unchanged:
            await site_store.touch_crawled_at(unchanged)
        logger.info(
            f"Scan [{domain}]: HEAD check complete — {len(unchanged)} unchanged, {len(needs_crawl)} need crawling"
        )

        # Phase 3: Crawl changed URLs in batches
        crawled_total = 0
        homepage_title: str | None = None
        homepage_description: str | None = None

        for i in range(0, len(needs_crawl), crawl_batch_size):
            if _is_cancelled(domain):
                logger.info(f"Scan [{domain}]: cancelled during crawl (crawled {crawled_total} so far)")
                await store_manager.update_scan_status(domain, "idle")
                return
            batch = needs_crawl[i : i + crawl_batch_size]
            logger.info(
                f"Scan [{domain}]: Phase 3 — crawling batch {i // crawl_batch_size + 1} "
                f"({len(batch)} URLs, total so far: {crawled_total})"
            )
            results = await crawler_service.crawl_urls(urls=batch)

            # Split: pages with content vs permanent errors vs transient errors vs network failures
            all_returned_urls = {p["url"] for p in results}
            crawled_pages = [p for p in results if p.get("content") is not None]
            gone_urls = [
                p["url"] for p in results if p.get("content") is None and p.get("status_code") in _PERMANENT_HTTP_ERRORS
            ]
            transient_error_urls = [
                p["url"]
                for p in results
                if p.get("content") is None and p.get("status_code") not in _PERMANENT_HTTP_ERRORS
            ]
            network_failed_urls = [u for u in batch if u not in all_returned_urls]

            for p in crawled_pages:
                sd_text = format_structured_data(p.get("structured_data"))
                if sd_text:
                    p["content"] = f"{p['content']}\n\n{sd_text}"
                    p["word_count"] = len(p["content"].split())

            updates = [
                {
                    "url": p["url"],
                    "content_hash": _sha256(p["content"]),
                    "status": "active",
                    "title": p.get("title"),
                    "content": p["content"],
                    "word_count": p.get("word_count", 0),
                    "metadata": p.get("metadata"),
                    "structured_data": p.get("structured_data"),
                }
                for p in crawled_pages
            ]
            await site_store.update_content_hashes(updates)
            crawled_total += len(updates)

            try:
                await store_manager.update_scan_status(domain, "scanning")
            except Exception:
                logger.warning(f"Scan [{domain}]: heartbeat failed, continuing")

            if homepage_title is None:
                for p in crawled_pages:
                    if _is_homepage(p["url"], domain):
                        homepage_title = p.get("title")
                        homepage_description = extract_meta_description(p.get("structured_data"))
                        break

            if indexing_service:
                for p in crawled_pages:
                    try:
                        await indexing_service.index_page(
                            domain=domain,
                            url=p["url"],
                            title=p.get("title"),
                            content=p["content"],
                        )
                    except Exception:
                        logger.exception(f"Indexing failed for {p['url']}")

            if gone_urls:
                total_count = await site_store.get_total_count()
                ratio = len(gone_urls) / total_count if total_count > 0 else 0.0
                if total_count > 0 and ratio > _MAX_DELETION_RATIO:
                    logger.error(
                        f"Scan [{domain}]: mass deletion blocked — "
                        f"{len(gone_urls)}/{total_count} URLs ({ratio:.0%}) exceed "
                        f"{_MAX_DELETION_RATIO:.0%} threshold. "
                        f"Falling back to fail_count increment."
                    )
                    await site_store.increment_fail_count(gone_urls)
                else:
                    sample = gone_urls[:5]
                    suffix = f" (and {len(gone_urls) - 5} more)" if len(gone_urls) > 5 else ""
                    logger.info(f"Scan [{domain}]: deleting {len(gone_urls)} gone URLs (404/410): {sample}{suffix}")
                    await site_store.mark_urls_deleted(gone_urls)

            error_urls = transient_error_urls + network_failed_urls
            if error_urls:
                logger.warning(
                    f"Scan [{domain}]: {len(error_urls)} URLs failed in batch "
                    f"({len(transient_error_urls)} HTTP errors, {len(network_failed_urls)} network failures)"
                )
                await site_store.increment_fail_count(error_urls)

            crawled_page_urls = {p["url"] for p in crawled_pages}
            first_time = [u for u in crawled_page_urls if u not in had_headers]
            if first_time:
                await _seed_cache_headers(first_time, site_store)

        logger.info(f"Scan [{domain}]: crawled {crawled_total}, skipped {len(unchanged)} unchanged URLs")

        # Phase 4: Update website metadata
        page_count = await site_store.get_total_count()
        await store_manager.update_website_metadata(
            domain=domain,
            title=homepage_title,
            description=homepage_description,
            page_count=page_count,
        )

        await store_manager.update_last_scanned(domain)
        await store_manager.update_scan_status(domain, "active")
        logger.info(f"Scan [{domain}]: complete (pages={page_count})")

    except Exception as e:
        logger.exception(f"Scan failed for {domain}")
        await store_manager.update_scan_status(domain, "error", str(e))

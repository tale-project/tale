"""
Async PostgreSQL-backed website store, replacing the SQLite multi-DB architecture.

PgWebsiteStore: per-domain URL operations (scoped by domain column).
PgWebsiteStoreManager: website registry + factory for PgWebsiteStore instances.
"""

import json
import logging
from datetime import UTC, datetime
from urllib.parse import urlparse

import asyncpg

logger = logging.getLogger(__name__)


class PgWebsiteStore:
    """Per-domain URL operations backed by PostgreSQL."""

    def __init__(self, pool: asyncpg.Pool, domain: str):
        self._pool = pool
        self._domain = domain

    async def save_discovered_urls(self, urls: list[dict]) -> int:
        """Save discovered URLs. Returns number of newly inserted URLs (excludes duplicates)."""
        if not urls:
            return 0

        async with self._pool.acquire() as conn:
            count_before = await conn.fetchval("SELECT COUNT(*) FROM website_urls WHERE domain = $1", self._domain)
            await conn.executemany(
                """INSERT INTO website_urls (domain, url, discovered_at)
                   VALUES ($1, $2, NOW())
                   ON CONFLICT (domain, url) DO NOTHING""",
                [(self._domain, u["url"]) for u in urls],
            )
            count_after = await conn.fetchval("SELECT COUNT(*) FROM website_urls WHERE domain = $1", self._domain)
            inserted = count_after - count_before
            logger.info(f"Saved discovered URLs for {self._domain}: {inserted} new, {count_after} total")
            return inserted

    async def get_urls_page(self, offset: int = 0, limit: int = 100, status: str | None = None) -> list[dict]:
        async with self._pool.acquire() as conn:
            if status:
                rows = await conn.fetch(
                    """SELECT url, content_hash, status, last_crawled_at
                       FROM website_urls
                       WHERE domain = $1 AND content_hash IS NOT NULL AND status = $2
                       ORDER BY id LIMIT $3 OFFSET $4""",
                    self._domain,
                    status,
                    limit,
                    offset,
                )
            else:
                rows = await conn.fetch(
                    """SELECT url, content_hash, status, last_crawled_at
                       FROM website_urls
                       WHERE domain = $1 AND content_hash IS NOT NULL
                       ORDER BY id LIMIT $2 OFFSET $3""",
                    self._domain,
                    limit,
                    offset,
                )
            return [
                {
                    "url": r["url"],
                    "content_hash": r["content_hash"],
                    "status": r["status"],
                    "last_crawled_at": r["last_crawled_at"].timestamp() if r["last_crawled_at"] else None,
                }
                for r in rows
            ]

    async def get_urls_needing_recrawl(self, limit: int = 20, crawled_before: float | None = None) -> list[str]:
        async with self._pool.acquire() as conn:
            if crawled_before is not None:
                ts = datetime.fromtimestamp(crawled_before, tz=UTC)
                rows = await conn.fetch(
                    """SELECT url FROM website_urls
                       WHERE domain = $1 AND status != 'deleted'
                         AND (last_crawled_at IS NULL OR last_crawled_at < $2)
                       ORDER BY CASE WHEN content_hash IS NULL THEN 0 ELSE 1 END,
                              last_crawled_at ASC NULLS FIRST
                       LIMIT $3""",
                    self._domain,
                    ts,
                    limit,
                )
            else:
                rows = await conn.fetch(
                    """SELECT url FROM website_urls
                       WHERE domain = $1 AND status != 'deleted'
                       ORDER BY CASE WHEN content_hash IS NULL THEN 0 ELSE 1 END,
                              last_crawled_at ASC NULLS FIRST
                       LIMIT $2""",
                    self._domain,
                    limit,
                )
            return [r["url"] for r in rows]

    async def increment_fail_count(self, urls: list[str]) -> None:
        if not urls:
            return
        async with self._pool.acquire() as conn:
            await conn.executemany(
                """UPDATE website_urls
                   SET fail_count = fail_count + 1, last_crawled_at = NOW()
                   WHERE domain = $1 AND url = $2""",
                [(self._domain, url) for url in urls],
            )

    async def update_content_hashes(self, updates: list[dict]) -> None:
        if not updates:
            return
        async with self._pool.acquire() as conn:
            await conn.executemany(
                """UPDATE website_urls
                   SET content_hash = $3, status = $4, last_crawled_at = NOW(),
                       title = $5, content = $6, word_count = $7,
                       metadata = $8::jsonb, structured_data = $9::jsonb,
                       fail_count = 0
                   WHERE domain = $1 AND url = $2""",
                [
                    (
                        self._domain,
                        u["url"],
                        u["content_hash"],
                        u.get("status", "active"),
                        u.get("title"),
                        u.get("content"),
                        u.get("word_count"),
                        json.dumps(u["metadata"]) if u.get("metadata") else None,
                        json.dumps(u["structured_data"]) if u.get("structured_data") else None,
                    )
                    for u in updates
                ],
            )

    async def mark_urls_deleted(self, urls: list[str]) -> None:
        if not urls:
            return
        async with self._pool.acquire() as conn:
            await conn.executemany(
                "UPDATE website_urls SET status = 'deleted' WHERE domain = $1 AND url = $2",
                [(self._domain, url) for url in urls],
            )

    async def get_cache_headers(self, urls: list[str]) -> dict[str, dict]:
        if not urls:
            return {}
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT url, etag, last_modified FROM website_urls
                   WHERE domain = $1 AND url = ANY($2)
                     AND (etag IS NOT NULL OR last_modified IS NOT NULL)""",
                self._domain,
                urls,
            )
            return {r["url"]: {"etag": r["etag"], "last_modified": r["last_modified"]} for r in rows}

    async def update_cache_headers(self, updates: list[dict]) -> None:
        if not updates:
            return
        async with self._pool.acquire() as conn:
            await conn.executemany(
                "UPDATE website_urls SET etag = $3, last_modified = $4 WHERE domain = $1 AND url = $2",
                [(self._domain, u["url"], u.get("etag"), u.get("last_modified")) for u in updates],
            )

    async def touch_crawled_at(self, urls: list[str]) -> None:
        if not urls:
            return
        async with self._pool.acquire() as conn:
            await conn.executemany(
                "UPDATE website_urls SET last_crawled_at = NOW() WHERE domain = $1 AND url = $2",
                [(self._domain, url) for url in urls],
            )

    async def get_total_count(self, status: str | None = None) -> int:
        async with self._pool.acquire() as conn:
            if status:
                return await conn.fetchval(
                    """SELECT COUNT(*) FROM website_urls
                       WHERE domain = $1 AND content_hash IS NOT NULL AND status = $2""",
                    self._domain,
                    status,
                )
            return await conn.fetchval(
                "SELECT COUNT(*) FROM website_urls WHERE domain = $1 AND content_hash IS NOT NULL",
                self._domain,
            )

    async def get_cached_pages(self, urls: list[str]) -> list[dict]:
        if not urls:
            return []
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT url, title, content, word_count, metadata, structured_data
                   FROM website_urls
                   WHERE domain = $1 AND url = ANY($2) AND content IS NOT NULL""",
                self._domain,
                urls,
            )
            return [
                {
                    "url": r["url"],
                    "title": r["title"],
                    "content": r["content"],
                    "word_count": r["word_count"] or 0,
                    "metadata": r["metadata"],
                    "structured_data": r["structured_data"],
                }
                for r in rows
            ]


class PgWebsiteStoreManager:
    """Website registry + factory for PgWebsiteStore instances."""

    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool
        self._stores: dict[str, PgWebsiteStore] = {}

    async def register_website(self, domain: str, scan_interval: int = 21600) -> dict:
        async with self._pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO websites (domain, scan_interval, created_at, updated_at)
                   VALUES ($1, $2, NOW(), NOW())
                   ON CONFLICT(domain) DO UPDATE SET
                     scan_interval = EXCLUDED.scan_interval,
                     updated_at = NOW()""",
                domain,
                scan_interval,
            )
        logger.info(f"Registered website: {domain} (interval={scan_interval}s)")
        return {"domain": domain, "scan_interval": scan_interval, "status": "idle"}

    async def update_website_metadata(
        self,
        domain: str,
        title: str | None = None,
        description: str | None = None,
        page_count: int | None = None,
    ) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                """UPDATE websites SET
                     title = COALESCE($2, title),
                     description = COALESCE($3, description),
                     page_count = COALESCE($4, page_count),
                     updated_at = NOW()
                   WHERE domain = $1""",
                domain,
                title,
                description,
                page_count,
            )

    async def remove_website(self, domain: str) -> bool:
        self._stores.pop(domain, None)
        async with self._pool.acquire() as conn:
            # ON DELETE CASCADE on website_urls and chunks handles child row cleanup
            result = await conn.execute("DELETE FROM websites WHERE domain = $1", domain)
            deleted = result == "DELETE 1"
        if deleted:
            logger.info(f"Removed website: {domain}")
        return deleted

    async def get_due_websites(self) -> list[dict]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT domain, status, scan_interval, last_scanned_at, error
                   FROM websites
                   WHERE status != 'scanning'
                     AND (last_scanned_at IS NULL
                          OR last_scanned_at + make_interval(secs => scan_interval) < NOW())"""
            )
            return [dict(r) for r in rows]

    async def update_scan_status(self, domain: str, status: str, error: str | None = None) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                "UPDATE websites SET status = $2, error = $3, updated_at = NOW() WHERE domain = $1",
                domain,
                status,
                error,
            )

    async def update_last_scanned(self, domain: str) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                "UPDATE websites SET last_scanned_at = NOW(), updated_at = NOW() WHERE domain = $1",
                domain,
            )

    async def get_website(self, domain: str) -> dict | None:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """SELECT w.domain, w.title, w.description, w.page_count, w.status,
                          w.scan_interval, w.last_scanned_at, w.error,
                          w.created_at, w.updated_at,
                          COALESCE(u.total, 0) AS total_urls,
                          COALESCE(u.crawled, 0) AS crawled_count
                   FROM websites w
                   LEFT JOIN LATERAL (
                       SELECT COUNT(*) AS total,
                              COUNT(*) FILTER (WHERE content_hash IS NOT NULL) AS crawled
                       FROM website_urls WHERE domain = w.domain
                   ) u ON true
                   WHERE w.domain = $1""",
                domain,
            )
            return dict(row) if row else None

    def get_site_store(self, domain: str) -> PgWebsiteStore:
        if domain not in self._stores:
            self._stores[domain] = PgWebsiteStore(self._pool, domain)
        return self._stores[domain]

    async def get_cached_pages(self, urls: list[str]) -> tuple[list[dict], list[str]]:
        if not urls:
            return [], []

        by_domain: dict[str, list[str]] = {}
        for url in urls:
            domain = urlparse(url).netloc
            by_domain.setdefault(domain, []).append(url)

        cached: list[dict] = []
        to_crawl: list[str] = []

        for domain, domain_urls in by_domain.items():
            website = await self.get_website(domain)
            if not website:
                to_crawl.extend(domain_urls)
                continue

            site_store = self.get_site_store(domain)
            hits = await site_store.get_cached_pages(domain_urls)
            hit_urls = {p["url"] for p in hits}
            cached.extend(hits)
            to_crawl.extend(u for u in domain_urls if u not in hit_urls)

        return cached, to_crawl

    async def close(self) -> None:
        self._stores.clear()
        logger.info("PgWebsiteStoreManager closed")

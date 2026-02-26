"""
Multi-DB SQLite store for website URL registry with content hashing.

Architecture:
- Main DB (data/crawler.db): websites table — registry of all tracked websites
- Per-site DB (data/sites/{domain}.db): website_urls table — URLs + content_hash per site

Benefits:
- Zero lock contention: each website has its own SQLite file, independent WAL
- Natural concurrency: different websites can be scanned in parallel
- Clean deletion: remove_website = close connection + unlink the .db file
"""

import json
import logging
import sqlite3
import time
from pathlib import Path
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

_DEFAULT_DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"


def _sanitize_domain(domain: str) -> str:
    return domain.replace(".", "_").replace("-", "_")


class WebsiteStore:
    """Manages one per-site SQLite file with URL registry and content hashes."""

    def __init__(self, db_path: Path):
        self._db_path = db_path
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn: sqlite3.Connection | None = None

    def _get_conn(self) -> sqlite3.Connection:
        if self._conn is None:
            self._conn = sqlite3.connect(str(self._db_path), timeout=30)
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA busy_timeout=5000")
            self._conn.row_factory = sqlite3.Row
            self._ensure_schema(self._conn)
        return self._conn

    @staticmethod
    def _ensure_schema(conn: sqlite3.Connection):
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS website_urls (
                url TEXT PRIMARY KEY,
                content_hash TEXT,
                status TEXT NOT NULL DEFAULT 'discovered',
                last_crawled_at REAL,
                discovered_at REAL NOT NULL,
                title TEXT,
                content TEXT,
                word_count INTEGER,
                metadata TEXT,
                structured_data TEXT,
                fail_count INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_crawl_order
                ON website_urls(last_crawled_at);
        """)

        # Migrate existing databases: add content cache columns if missing
        existing = {row[1] for row in conn.execute("PRAGMA table_info(website_urls)").fetchall()}
        for col, col_type in [
            ("title", "TEXT"),
            ("content", "TEXT"),
            ("word_count", "INTEGER"),
            ("metadata", "TEXT"),
            ("structured_data", "TEXT"),
            ("fail_count", "INTEGER NOT NULL DEFAULT 0"),
            ("etag", "TEXT"),
            ("last_modified", "TEXT"),
        ]:
            if col not in existing:
                conn.execute(f"ALTER TABLE website_urls ADD COLUMN {col} {col_type}")

        conn.commit()

    def save_discovered_urls(self, urls: list[dict]) -> int:
        if not urls:
            return 0

        now = time.time()
        rows = [(u["url"], now) for u in urls]
        conn = self._get_conn()
        conn.executemany(
            "INSERT OR IGNORE INTO website_urls (url, discovered_at) VALUES (?, ?)",
            rows,
        )
        inserted = conn.total_changes
        conn.commit()
        return inserted

    def get_urls_page(self, offset: int = 0, limit: int = 100, status: str | None = None) -> list[dict]:
        conn = self._get_conn()
        if status:
            rows = conn.execute(
                "SELECT url, content_hash, status, last_crawled_at "
                "FROM website_urls WHERE content_hash IS NOT NULL AND status = ? "
                "ORDER BY rowid LIMIT ? OFFSET ?",
                (status, limit, offset),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT url, content_hash, status, last_crawled_at "
                "FROM website_urls WHERE content_hash IS NOT NULL "
                "ORDER BY rowid LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall()

        return [
            {
                "url": r["url"],
                "content_hash": r["content_hash"],
                "status": r["status"],
                "last_crawled_at": r["last_crawled_at"],
            }
            for r in rows
        ]

    def get_urls_needing_recrawl(self, limit: int = 20, crawled_before: float | None = None) -> list[str]:
        conn = self._get_conn()
        if crawled_before is not None:
            rows = conn.execute(
                "SELECT url FROM website_urls "
                "WHERE status != 'deleted' "
                "AND (last_crawled_at IS NULL OR last_crawled_at < ?) "
                "ORDER BY CASE WHEN content_hash IS NULL THEN 0 ELSE 1 END, "
                "last_crawled_at ASC NULLS FIRST "
                "LIMIT ?",
                (crawled_before, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT url FROM website_urls "
                "WHERE status != 'deleted' "
                "ORDER BY CASE WHEN content_hash IS NULL THEN 0 ELSE 1 END, "
                "last_crawled_at ASC NULLS FIRST "
                "LIMIT ?",
                (limit,),
            ).fetchall()
        return [r["url"] for r in rows]

    def increment_fail_count(self, urls: list[str]):
        if not urls:
            return

        now = time.time()
        conn = self._get_conn()
        conn.executemany(
            "UPDATE website_urls SET fail_count = fail_count + 1, last_crawled_at = ? WHERE url = ?",
            [(now, url) for url in urls],
        )
        conn.commit()

    def update_content_hashes(self, updates: list[dict]):
        if not updates:
            return

        now = time.time()
        conn = self._get_conn()
        conn.executemany(
            "UPDATE website_urls "
            "SET content_hash = ?, status = ?, last_crawled_at = ?, "
            "    title = ?, content = ?, word_count = ?, metadata = ?, structured_data = ?, "
            "    fail_count = 0 "
            "WHERE url = ?",
            [
                (
                    u["content_hash"],
                    u.get("status", "active"),
                    now,
                    u.get("title"),
                    u.get("content"),
                    u.get("word_count"),
                    u.get("metadata"),
                    u.get("structured_data"),
                    u["url"],
                )
                for u in updates
            ],
        )
        conn.commit()

    def mark_urls_deleted(self, urls: list[str]):
        if not urls:
            return

        conn = self._get_conn()
        conn.executemany(
            "UPDATE website_urls SET status = 'deleted' WHERE url = ?",
            [(url,) for url in urls],
        )
        conn.commit()

    def get_cache_headers(self, urls: list[str]) -> dict[str, dict]:
        """Load stored etag/last_modified for URLs that have at least one header."""
        if not urls:
            return {}

        conn = self._get_conn()
        placeholders = ",".join("?" * len(urls))
        rows = conn.execute(
            "SELECT url, etag, last_modified FROM website_urls "
            f"WHERE url IN ({placeholders}) AND (etag IS NOT NULL OR last_modified IS NOT NULL)",
            urls,
        ).fetchall()

        return {r["url"]: {"etag": r["etag"], "last_modified": r["last_modified"]} for r in rows}

    def update_cache_headers(self, updates: list[dict]):
        """Batch store etag/last_modified from HEAD responses."""
        if not updates:
            return

        conn = self._get_conn()
        conn.executemany(
            "UPDATE website_urls SET etag = ?, last_modified = ? WHERE url = ?",
            [(u.get("etag"), u.get("last_modified"), u["url"]) for u in updates],
        )
        conn.commit()

    def touch_crawled_at(self, urls: list[str]):
        """Update only last_crawled_at for unchanged URLs (skipped by 304)."""
        if not urls:
            return

        now = time.time()
        conn = self._get_conn()
        conn.executemany(
            "UPDATE website_urls SET last_crawled_at = ? WHERE url = ?",
            [(now, url) for url in urls],
        )
        conn.commit()

    def get_total_count(self, status: str | None = None) -> int:
        conn = self._get_conn()
        if status:
            row = conn.execute(
                "SELECT COUNT(*) as cnt FROM website_urls WHERE content_hash IS NOT NULL AND status = ?",
                (status,),
            ).fetchone()
        else:
            row = conn.execute("SELECT COUNT(*) as cnt FROM website_urls WHERE content_hash IS NOT NULL").fetchone()
        return row["cnt"] if row else 0

    def get_cached_pages(self, urls: list[str]) -> list[dict]:
        if not urls:
            return []

        conn = self._get_conn()
        placeholders = ",".join("?" * len(urls))
        rows = conn.execute(
            "SELECT url, title, content, word_count, metadata, structured_data "
            f"FROM website_urls WHERE url IN ({placeholders}) AND content IS NOT NULL",
            urls,
        ).fetchall()

        return [
            {
                "url": r["url"],
                "title": r["title"],
                "content": r["content"],
                "word_count": r["word_count"] or 0,
                "metadata": json.loads(r["metadata"]) if r["metadata"] else None,
                "structured_data": json.loads(r["structured_data"]) if r["structured_data"] else None,
            }
            for r in rows
        ]

    def close(self):
        if self._conn:
            self._conn.close()
            self._conn = None


class WebsiteStoreManager:
    """Manages main DB (website registry) + per-site WebsiteStore instances."""

    def __init__(self, data_dir: Path | None = None):
        self._data_dir = data_dir or _DEFAULT_DATA_DIR
        self._data_dir.mkdir(parents=True, exist_ok=True)
        self._main_db_path = self._data_dir / "crawler.db"
        self._sites_dir = self._data_dir / "sites"
        self._sites_dir.mkdir(parents=True, exist_ok=True)
        self._stores: dict[str, WebsiteStore] = {}
        self._main_conn: sqlite3.Connection | None = None
        self._init_main_db()

    def _get_main_conn(self) -> sqlite3.Connection:
        if self._main_conn is None:
            self._main_conn = sqlite3.connect(str(self._main_db_path), timeout=30)
            self._main_conn.execute("PRAGMA journal_mode=WAL")
            self._main_conn.execute("PRAGMA busy_timeout=5000")
            self._main_conn.row_factory = sqlite3.Row
        return self._main_conn

    def _init_main_db(self):
        conn = self._get_main_conn()
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS websites (
                domain TEXT PRIMARY KEY,
                status TEXT NOT NULL DEFAULT 'idle',
                scan_interval INTEGER NOT NULL DEFAULT 21600,
                last_scanned_at REAL,
                error TEXT,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            );
        """)
        conn.commit()
        logger.info(f"Website store manager initialized at {self._data_dir}")

    def register_website(self, domain: str, scan_interval: int = 21600) -> dict:
        now = time.time()
        conn = self._get_main_conn()
        conn.execute(
            """INSERT INTO websites (domain, scan_interval, created_at, updated_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(domain) DO UPDATE SET
                 scan_interval = excluded.scan_interval,
                 updated_at = excluded.updated_at""",
            (domain, scan_interval, now, now),
        )
        conn.commit()
        logger.info(f"Registered website: {domain} (interval={scan_interval}s)")
        return {"domain": domain, "scan_interval": scan_interval, "status": "idle"}

    def remove_website(self, domain: str) -> bool:
        if domain in self._stores:
            self._stores[domain].close()
            del self._stores[domain]

        db_file = self._sites_dir / f"{_sanitize_domain(domain)}.db"
        if db_file.exists():
            db_file.unlink()
            wal = db_file.with_suffix(".db-wal")
            shm = db_file.with_suffix(".db-shm")
            if wal.exists():
                wal.unlink()
            if shm.exists():
                shm.unlink()

        conn = self._get_main_conn()
        cursor = conn.execute("DELETE FROM websites WHERE domain = ?", (domain,))
        conn.commit()
        deleted = cursor.rowcount > 0
        if deleted:
            logger.info(f"Removed website: {domain}")
        return deleted

    def get_due_websites(self) -> list[dict]:
        now = time.time()
        conn = self._get_main_conn()
        rows = conn.execute(
            """SELECT domain, status, scan_interval, last_scanned_at, error
               FROM websites
               WHERE status != 'scanning'
                 AND (last_scanned_at IS NULL
                      OR last_scanned_at + scan_interval < ?)""",
            (now,),
        ).fetchall()
        return [dict(r) for r in rows]

    def update_scan_status(self, domain: str, status: str, error: str | None = None):
        now = time.time()
        conn = self._get_main_conn()
        conn.execute(
            "UPDATE websites SET status = ?, error = ?, updated_at = ? WHERE domain = ?",
            (status, error, now, domain),
        )
        conn.commit()

    def update_last_scanned(self, domain: str):
        now = time.time()
        conn = self._get_main_conn()
        conn.execute(
            "UPDATE websites SET last_scanned_at = ?, updated_at = ? WHERE domain = ?",
            (now, now, domain),
        )
        conn.commit()

    def get_website(self, domain: str) -> dict | None:
        conn = self._get_main_conn()
        row = conn.execute(
            "SELECT domain, status, scan_interval, last_scanned_at, error, created_at, updated_at "
            "FROM websites WHERE domain = ?",
            (domain,),
        ).fetchone()
        return dict(row) if row else None

    def get_site_store(self, domain: str) -> WebsiteStore:
        if domain not in self._stores:
            db_path = self._sites_dir / f"{_sanitize_domain(domain)}.db"
            self._stores[domain] = WebsiteStore(db_path)
        return self._stores[domain]

    def get_cached_pages(self, urls: list[str]) -> tuple[list[dict], list[str]]:
        """Return cached page content for URLs with registered websites.

        Returns (cached_pages, urls_needing_crawl).
        """
        if not urls:
            return [], []

        by_domain: dict[str, list[str]] = {}
        for url in urls:
            domain = urlparse(url).netloc
            by_domain.setdefault(domain, []).append(url)

        cached: list[dict] = []
        to_crawl: list[str] = []

        for domain, domain_urls in by_domain.items():
            if not self.get_website(domain):
                to_crawl.extend(domain_urls)
                continue

            site_store = self.get_site_store(domain)
            hits = site_store.get_cached_pages(domain_urls)
            hit_urls = {p["url"] for p in hits}
            cached.extend(hits)
            to_crawl.extend(u for u in domain_urls if u not in hit_urls)

        return cached, to_crawl

    def close_all(self):
        for store in self._stores.values():
            store.close()
        self._stores.clear()
        if self._main_conn:
            self._main_conn.close()
            self._main_conn = None
        logger.info("All website stores closed")


_store_manager: WebsiteStoreManager | None = None


def get_website_store_manager() -> WebsiteStoreManager:
    global _store_manager
    if _store_manager is None:
        _store_manager = WebsiteStoreManager()
    return _store_manager

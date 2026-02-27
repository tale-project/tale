"""
Multi-DB SQLite store for website URL registry with content hashing.

Architecture:
- Main DB (data/crawler.db): websites table — registry of all tracked websites
- Per-site DB (data/sites/{url_slug}.db): website_urls table — URLs + content_hash per site

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


def _normalize_url(raw: str) -> str:
    """Normalize input to full URL: add scheme, ensure path."""
    if not raw.startswith(("http://", "https://")):
        raw = f"https://{raw}"
    parsed = urlparse(raw)
    path = parsed.path or "/"
    return f"{parsed.scheme}://{parsed.netloc}{path}"


def _url_to_filename(url: str) -> str:
    """Convert normalized URL to safe SQLite filename."""
    parsed = urlparse(url)
    domain_part = parsed.netloc.replace(".", "_").replace("-", "_")
    path = parsed.path.strip("/")
    if not path:
        return domain_part
    path_part = path.replace("/", "_").replace(".", "_").replace("-", "_")
    return f"{domain_part}__{path_part}"


class WebsiteStore:
    """Manages one per-site SQLite file with URL registry and content hashes."""

    def __init__(self, db_path: Path):
        self._db_path = db_path
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn: sqlite3.Connection | None = None
        self._get_conn()

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

        # Check if we need to migrate from old domain-based schema
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        if "websites" in tables:
            columns = {row[1] for row in conn.execute("PRAGMA table_info(websites)").fetchall()}
            if "domain" in columns and "url" not in columns:
                self._migrate_domain_to_url(conn)
                logger.info("Migrated websites table from domain to url schema")
                return

        conn.executescript("""
            CREATE TABLE IF NOT EXISTS websites (
                url TEXT PRIMARY KEY,
                domain TEXT NOT NULL,
                path_prefix TEXT NOT NULL DEFAULT '/',
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

    @staticmethod
    def _migrate_domain_to_url(conn: sqlite3.Connection):
        """Migrate from old domain-based schema to url-based schema."""
        conn.executescript("""
            CREATE TABLE websites_new (
                url TEXT PRIMARY KEY,
                domain TEXT NOT NULL,
                path_prefix TEXT NOT NULL DEFAULT '/',
                status TEXT NOT NULL DEFAULT 'idle',
                scan_interval INTEGER NOT NULL DEFAULT 21600,
                last_scanned_at REAL,
                error TEXT,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            );
        """)
        rows = conn.execute("SELECT * FROM websites").fetchall()
        for row in rows:
            old_domain = row["domain"]
            new_url = f"https://{old_domain}/"
            conn.execute(
                "INSERT INTO websites_new (url, domain, path_prefix, status, scan_interval, "
                "last_scanned_at, error, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    new_url,
                    old_domain,
                    "/",
                    row["status"],
                    row["scan_interval"],
                    row["last_scanned_at"],
                    row["error"],
                    row["created_at"],
                    row["updated_at"],
                ),
            )
        conn.execute("DROP TABLE websites")
        conn.execute("ALTER TABLE websites_new RENAME TO websites")
        conn.commit()

    def register_website(self, url: str, scan_interval: int = 21600) -> dict:
        normalized = _normalize_url(url)
        parsed = urlparse(normalized)
        domain = parsed.netloc
        path_prefix = parsed.path or "/"

        now = time.time()
        conn = self._get_main_conn()
        conn.execute(
            """INSERT INTO websites (url, domain, path_prefix, scan_interval, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(url) DO UPDATE SET
                 scan_interval = excluded.scan_interval,
                 updated_at = excluded.updated_at""",
            (normalized, domain, path_prefix, scan_interval, now, now),
        )
        conn.commit()
        logger.info(f"Registered website: {normalized} (interval={scan_interval}s)")
        return {
            "url": normalized,
            "domain": domain,
            "path_prefix": path_prefix,
            "scan_interval": scan_interval,
            "status": "idle",
        }

    def remove_website(self, url: str) -> bool:
        normalized = _normalize_url(url)
        if normalized in self._stores:
            self._stores[normalized].close()
            del self._stores[normalized]

        db_file = self._sites_dir / f"{_url_to_filename(normalized)}.db"
        if db_file.exists():
            db_file.unlink()
            wal = db_file.with_suffix(".db-wal")
            shm = db_file.with_suffix(".db-shm")
            if wal.exists():
                wal.unlink()
            if shm.exists():
                shm.unlink()

        conn = self._get_main_conn()
        cursor = conn.execute("DELETE FROM websites WHERE url = ?", (normalized,))
        conn.commit()
        deleted = cursor.rowcount > 0
        if deleted:
            logger.info(f"Removed website: {normalized}")
        return deleted

    def get_due_websites(self) -> list[dict]:
        now = time.time()
        conn = self._get_main_conn()
        rows = conn.execute(
            """SELECT url, domain, path_prefix, status, scan_interval, last_scanned_at, error
               FROM websites
               WHERE status != 'scanning'
                 AND (last_scanned_at IS NULL
                      OR last_scanned_at + scan_interval < ?)""",
            (now,),
        ).fetchall()
        return [dict(r) for r in rows]

    def update_scan_status(self, url: str, status: str, error: str | None = None):
        now = time.time()
        conn = self._get_main_conn()
        conn.execute(
            "UPDATE websites SET status = ?, error = ?, updated_at = ? WHERE url = ?",
            (status, error, now, url),
        )
        conn.commit()

    def update_last_scanned(self, url: str):
        now = time.time()
        conn = self._get_main_conn()
        conn.execute(
            "UPDATE websites SET last_scanned_at = ?, updated_at = ? WHERE url = ?",
            (now, now, url),
        )
        conn.commit()

    def get_website(self, url: str) -> dict | None:
        normalized = _normalize_url(url)
        conn = self._get_main_conn()
        row = conn.execute(
            "SELECT url, domain, path_prefix, status, scan_interval, "
            "last_scanned_at, error, created_at, updated_at "
            "FROM websites WHERE url = ?",
            (normalized,),
        ).fetchone()
        return dict(row) if row else None

    def get_site_store(self, url: str) -> WebsiteStore:
        normalized = _normalize_url(url)
        if normalized not in self._stores:
            db_path = self._sites_dir / f"{_url_to_filename(normalized)}.db"
            self._stores[normalized] = WebsiteStore(db_path)
        return self._stores[normalized]

    def _get_websites_by_domain(self, domain: str) -> list[dict]:
        """Get all registered websites for a given domain, sorted by longest path_prefix first."""
        conn = self._get_main_conn()
        rows = conn.execute(
            "SELECT url, domain, path_prefix FROM websites WHERE domain = ? ORDER BY LENGTH(path_prefix) DESC",
            (domain,),
        ).fetchall()
        return [dict(r) for r in rows]

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
            registrations = self._get_websites_by_domain(domain)
            if not registrations:
                to_crawl.extend(domain_urls)
                continue

            for url in domain_urls:
                url_path = urlparse(url).path or "/"
                matched = None
                for reg in registrations:
                    if url_path.startswith(reg["path_prefix"]):
                        matched = reg
                        break

                if not matched:
                    to_crawl.append(url)
                    continue

                site_store = self.get_site_store(matched["url"])
                hits = site_store.get_cached_pages([url])
                if hits:
                    cached.extend(hits)
                else:
                    to_crawl.append(url)

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

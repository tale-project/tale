"""
SQLite-based persistence layer for URL discovery sessions.

Stores discovered URLs per domain with append-only semantics:
- New URLs are added via INSERT OR IGNORE (dedup by domain+url)
- Data persists across service restarts
- Same domain shares one session — no duplicate discovery
"""

import json
import logging
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

# Default database path relative to crawler service root
_DEFAULT_DB_DIR = Path(__file__).resolve().parent.parent.parent / "data"
_DEFAULT_DB_PATH = _DEFAULT_DB_DIR / "discovery.db"


@dataclass
class DiscoverySession:
    domain: str
    is_complete: bool
    error: str | None
    created_at: float
    updated_at: float


@dataclass
class DiscoveryPage:
    urls: list[dict]
    total_discovered: int
    is_complete: bool
    offset: int


class DiscoveryStore:
    """SQLite store for URL discovery sessions and discovered URLs."""

    def __init__(self, db_path: Path | None = None):
        self._db_path = db_path or _DEFAULT_DB_PATH
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path), timeout=30)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        with self._get_conn() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS discovery_sessions (
                    domain TEXT PRIMARY KEY,
                    is_complete BOOLEAN DEFAULT FALSE,
                    error TEXT,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS discovered_urls (
                    domain TEXT NOT NULL,
                    url TEXT NOT NULL,
                    status TEXT DEFAULT 'valid',
                    metadata TEXT,
                    discovered_at REAL NOT NULL,
                    PRIMARY KEY (domain, url)
                );

                CREATE INDEX IF NOT EXISTS idx_discovered_urls_domain
                    ON discovered_urls(domain);
            """)
        logger.info(f"Discovery store initialized at {self._db_path}")

    def get_session(self, domain: str) -> DiscoverySession | None:
        """Get existing discovery session for a domain."""
        with self._get_conn() as conn:
            row = conn.execute(
                "SELECT * FROM discovery_sessions WHERE domain = ?",
                (domain,),
            ).fetchone()

        if not row:
            return None

        return DiscoverySession(
            domain=row["domain"],
            is_complete=bool(row["is_complete"]),
            error=row["error"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def create_session(self, domain: str) -> DiscoverySession:
        """Create a new discovery session, replacing any existing one for this domain."""
        now = time.time()
        with self._get_conn() as conn:
            conn.execute(
                """INSERT INTO discovery_sessions (domain, is_complete, error, created_at, updated_at)
                   VALUES (?, FALSE, NULL, ?, ?)
                   ON CONFLICT(domain) DO UPDATE SET
                     is_complete = FALSE,
                     error = NULL,
                     created_at = excluded.created_at,
                     updated_at = excluded.updated_at""",
                (domain, now, now),
            )

        return DiscoverySession(
            domain=domain,
            is_complete=False,
            error=None,
            created_at=now,
            updated_at=now,
        )

    def store_urls(self, domain: str, urls: list[dict]):
        """
        Batch insert discovered URLs. Uses INSERT OR IGNORE for dedup.

        Args:
            domain: The domain these URLs belong to
            urls: List of dicts with at least 'url' key, optionally 'status' and 'metadata'
        """
        if not urls:
            return

        now = time.time()
        rows = [
            (
                domain,
                u["url"],
                u.get("status", "valid"),
                json.dumps(u.get("metadata")) if u.get("metadata") else None,
                now,
            )
            for u in urls
        ]

        with self._get_conn() as conn:
            conn.executemany(
                """INSERT OR IGNORE INTO discovered_urls (domain, url, status, metadata, discovered_at)
                   VALUES (?, ?, ?, ?, ?)""",
                rows,
            )
            conn.execute(
                "UPDATE discovery_sessions SET updated_at = ? WHERE domain = ?",
                (now, domain),
            )

        logger.info(f"Stored {len(rows)} URLs for {domain} (duplicates ignored)")

    def mark_complete(self, domain: str):
        """Mark a discovery session as complete."""
        now = time.time()
        with self._get_conn() as conn:
            conn.execute(
                "UPDATE discovery_sessions SET is_complete = TRUE, updated_at = ? WHERE domain = ?",
                (now, domain),
            )

    def mark_error(self, domain: str, error: str):
        """Mark a discovery session as failed with an error."""
        now = time.time()
        with self._get_conn() as conn:
            conn.execute(
                "UPDATE discovery_sessions SET is_complete = TRUE, error = ?, updated_at = ? WHERE domain = ?",
                (error, now, domain),
            )

    def get_url_count(self, domain: str) -> int:
        """Get the number of discovered URLs for a domain."""
        with self._get_conn() as conn:
            row = conn.execute(
                "SELECT COUNT(*) as cnt FROM discovered_urls WHERE domain = ?",
                (domain,),
            ).fetchone()
        return row["cnt"] if row else 0

    def get_page(self, domain: str, offset: int, limit: int) -> DiscoveryPage:
        """
        Get a page of discovered URLs for a domain.

        Args:
            domain: The domain to query
            offset: Number of URLs to skip
            limit: Maximum URLs to return
        """
        with self._get_conn() as conn:
            rows = conn.execute(
                "SELECT url, status FROM discovered_urls WHERE domain = ? ORDER BY rowid LIMIT ? OFFSET ?",
                (domain, limit, offset),
            ).fetchall()

            total = conn.execute(
                "SELECT COUNT(*) as cnt FROM discovered_urls WHERE domain = ?",
                (domain,),
            ).fetchone()["cnt"]

            session_row = conn.execute(
                "SELECT is_complete FROM discovery_sessions WHERE domain = ?",
                (domain,),
            ).fetchone()

        is_complete = bool(session_row["is_complete"]) if session_row else False

        return DiscoveryPage(
            urls=[{"url": r["url"], "status": r["status"]} for r in rows],
            total_discovered=total,
            is_complete=is_complete,
            offset=offset,
        )


# Global store instance
_store: DiscoveryStore | None = None


def get_discovery_store() -> DiscoveryStore:
    """Get or create the global discovery store instance."""
    global _store
    if _store is None:
        _store = DiscoveryStore()
    return _store

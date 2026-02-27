"""
Tests for WebsiteStore and WebsiteStoreManager.

Uses importlib to load website_store directly, bypassing the app.services
barrel __init__.py which pulls in heavy dependencies (playwright, crawl4ai).
"""

import importlib.util
import sys
from pathlib import Path

import pytest

# Load website_store module directly to avoid app.services.__init__ barrel import
_module_path = Path(__file__).resolve().parent.parent / "app" / "services" / "website_store.py"
_spec = importlib.util.spec_from_file_location("website_store", _module_path)
_mod = importlib.util.module_from_spec(_spec)
sys.modules["website_store"] = _mod
_spec.loader.exec_module(_mod)

WebsiteStore = _mod.WebsiteStore
WebsiteStoreManager = _mod.WebsiteStoreManager
_normalize_url = _mod._normalize_url
_url_to_filename = _mod._url_to_filename


@pytest.fixture
def tmp_data_dir(tmp_path):
    return tmp_path / "data"


@pytest.fixture
def site_store(tmp_path):
    db_path = tmp_path / "sites" / "example_com.db"
    store = WebsiteStore(db_path)
    yield store
    store.close()


@pytest.fixture
def manager(tmp_data_dir):
    mgr = WebsiteStoreManager(data_dir=tmp_data_dir)
    yield mgr
    mgr.close_all()


class TestNormalizeUrl:
    def test_bare_domain(self):
        assert _normalize_url("example.com") == "https://example.com/"

    def test_domain_with_path(self):
        assert _normalize_url("docs.python.org/3.12/") == "https://docs.python.org/3.12/"

    def test_full_url(self):
        assert _normalize_url("https://github.com/user/repo") == "https://github.com/user/repo"

    def test_http_scheme(self):
        assert _normalize_url("http://example.com/path") == "http://example.com/path"

    def test_no_path_adds_slash(self):
        assert _normalize_url("https://example.com") == "https://example.com/"


class TestUrlToFilename:
    def test_bare_domain(self):
        assert _url_to_filename("https://example.com/") == "example_com"

    def test_domain_with_path(self):
        assert _url_to_filename("https://docs.python.org/3.12/") == "docs_python_org__3_12"

    def test_deep_path(self):
        assert _url_to_filename("https://github.com/user/repo") == "github_com__user_repo"

    def test_hyphens_in_domain(self):
        assert _url_to_filename("https://my-site.example.com/") == "my_site_example_com"

    def test_backward_compat_no_path(self):
        # Bare domains produce the same filename as the old _sanitize_domain
        assert _url_to_filename("https://example.com/") == "example_com"
        assert _url_to_filename("https://my-site.example.com/") == "my_site_example_com"


class TestWebsiteStore:
    def test_creates_db_file(self, tmp_path):
        db_path = tmp_path / "nested" / "dir" / "test.db"
        store = WebsiteStore(db_path)
        assert db_path.exists()
        store.close()

    def test_save_discovered_urls(self, site_store):
        urls = [{"url": "https://example.com/a"}, {"url": "https://example.com/b"}]
        inserted = site_store.save_discovered_urls(urls)
        assert inserted >= 2
        # Discovered URLs have no content_hash yet, so not counted
        assert site_store.get_total_count() == 0

    def test_save_discovered_urls_ignores_duplicates(self, site_store):
        urls = [{"url": "https://example.com/a"}]
        site_store.save_discovered_urls(urls)
        site_store.save_discovered_urls(urls)
        assert site_store.get_total_count() == 0

    def test_save_discovered_urls_empty(self, site_store):
        assert site_store.save_discovered_urls([]) == 0

    def test_get_urls_page_excludes_null_hash(self, site_store):
        site_store.save_discovered_urls([{"url": "https://example.com/a"}])
        assert site_store.get_urls_page() == []

    def test_get_urls_page_basic(self, site_store):
        urls = [{"url": f"https://example.com/{i}"} for i in range(5)]
        site_store.save_discovered_urls(urls)
        site_store.update_content_hashes(
            [{"url": f"https://example.com/{i}", "content_hash": f"h{i}"} for i in range(5)]
        )

        page = site_store.get_urls_page(offset=0, limit=3)
        assert len(page) == 3
        assert all("url" in p and "content_hash" in p and "status" in p for p in page)

    def test_get_urls_page_offset(self, site_store):
        urls = [{"url": f"https://example.com/{i}"} for i in range(5)]
        site_store.save_discovered_urls(urls)
        site_store.update_content_hashes(
            [{"url": f"https://example.com/{i}", "content_hash": f"h{i}"} for i in range(5)]
        )

        page = site_store.get_urls_page(offset=3, limit=10)
        assert len(page) == 2

    def test_get_urls_page_with_status_filter(self, site_store):
        urls = [{"url": "https://example.com/a"}, {"url": "https://example.com/b"}]
        site_store.save_discovered_urls(urls)

        site_store.update_content_hashes(
            [
                {"url": "https://example.com/a", "content_hash": "abc", "status": "active"},
            ]
        )

        active = site_store.get_urls_page(status="active")
        assert len(active) == 1
        assert active[0]["url"] == "https://example.com/a"

        # discovered URL has no hash, so excluded
        discovered = site_store.get_urls_page(status="discovered")
        assert len(discovered) == 0

    def test_update_content_hashes(self, site_store):
        site_store.save_discovered_urls([{"url": "https://example.com/page"}])

        site_store.update_content_hashes(
            [
                {"url": "https://example.com/page", "content_hash": "sha256abc"},
            ]
        )

        pages = site_store.get_urls_page()
        assert len(pages) == 1
        assert pages[0]["content_hash"] == "sha256abc"
        assert pages[0]["status"] == "active"
        assert pages[0]["last_crawled_at"] is not None

    def test_update_content_hashes_empty(self, site_store):
        # Should not raise
        site_store.update_content_hashes([])

    def test_mark_urls_deleted(self, site_store):
        site_store.save_discovered_urls(
            [
                {"url": "https://example.com/a"},
                {"url": "https://example.com/b"},
            ]
        )
        site_store.update_content_hashes(
            [
                {"url": "https://example.com/a", "content_hash": "ha", "status": "active"},
                {"url": "https://example.com/b", "content_hash": "hb", "status": "active"},
            ]
        )

        site_store.mark_urls_deleted(["https://example.com/a"])

        deleted = site_store.get_urls_page(status="deleted")
        assert len(deleted) == 1
        assert deleted[0]["url"] == "https://example.com/a"

        active = site_store.get_urls_page(status="active")
        assert len(active) == 1

    def test_mark_urls_deleted_empty(self, site_store):
        site_store.mark_urls_deleted([])

    def test_get_urls_needing_recrawl_prefers_no_hash(self, site_store):
        site_store.save_discovered_urls(
            [
                {"url": "https://example.com/new"},
                {"url": "https://example.com/old"},
            ]
        )
        site_store.update_content_hashes(
            [
                {"url": "https://example.com/old", "content_hash": "h1"},
            ]
        )

        needing = site_store.get_urls_needing_recrawl(limit=10)
        assert len(needing) == 2
        # URL without hash should come first
        assert needing[0] == "https://example.com/new"

    def test_get_urls_needing_recrawl_excludes_deleted(self, site_store):
        site_store.save_discovered_urls(
            [
                {"url": "https://example.com/a"},
                {"url": "https://example.com/b"},
            ]
        )
        site_store.mark_urls_deleted(["https://example.com/a"])

        needing = site_store.get_urls_needing_recrawl(limit=10)
        assert len(needing) == 1
        assert needing[0] == "https://example.com/b"

    def test_get_urls_needing_recrawl_respects_limit(self, site_store):
        urls = [{"url": f"https://example.com/{i}"} for i in range(10)]
        site_store.save_discovered_urls(urls)

        needing = site_store.get_urls_needing_recrawl(limit=3)
        assert len(needing) == 3

    def test_get_urls_needing_recrawl_crawled_before_excludes_recent(self, site_store):
        import time

        site_store.save_discovered_urls(
            [
                {"url": "https://example.com/a"},
                {"url": "https://example.com/b"},
            ]
        )
        cutoff = time.time()
        # Crawl one URL after the cutoff
        site_store.update_content_hashes([{"url": "https://example.com/a", "content_hash": "h1"}])

        needing = site_store.get_urls_needing_recrawl(limit=10, crawled_before=cutoff)
        assert needing == ["https://example.com/b"]

    def test_get_urls_needing_recrawl_crawled_before_includes_stale(self, site_store):
        import time

        site_store.save_discovered_urls(
            [
                {"url": "https://example.com/a"},
                {"url": "https://example.com/b"},
            ]
        )
        # Crawl both URLs
        site_store.update_content_hashes(
            [
                {"url": "https://example.com/a", "content_hash": "h1"},
                {"url": "https://example.com/b", "content_hash": "h2"},
            ]
        )
        cutoff = time.time()

        # Both were crawled before cutoff, so both should be returned
        needing = site_store.get_urls_needing_recrawl(limit=10, crawled_before=cutoff)
        assert len(needing) == 2

    def test_increment_fail_count(self, site_store):
        site_store.save_discovered_urls([{"url": "https://example.com/flaky"}])

        site_store.increment_fail_count(["https://example.com/flaky"])
        conn = site_store._get_conn()
        row = conn.execute(
            "SELECT fail_count, last_crawled_at FROM website_urls WHERE url = ?",
            ("https://example.com/flaky",),
        ).fetchone()
        assert row["fail_count"] == 1
        assert row["last_crawled_at"] is not None

    def test_increment_fail_count_accumulates(self, site_store):
        site_store.save_discovered_urls([{"url": "https://example.com/flaky"}])

        site_store.increment_fail_count(["https://example.com/flaky"])
        site_store.increment_fail_count(["https://example.com/flaky"])
        site_store.increment_fail_count(["https://example.com/flaky"])

        conn = site_store._get_conn()
        row = conn.execute(
            "SELECT fail_count FROM website_urls WHERE url = ?",
            ("https://example.com/flaky",),
        ).fetchone()
        assert row["fail_count"] == 3

    def test_increment_fail_count_empty(self, site_store):
        site_store.increment_fail_count([])

    def test_successful_crawl_resets_fail_count(self, site_store):
        site_store.save_discovered_urls([{"url": "https://example.com/flaky"}])
        site_store.increment_fail_count(["https://example.com/flaky"])
        site_store.increment_fail_count(["https://example.com/flaky"])

        site_store.update_content_hashes([{"url": "https://example.com/flaky", "content_hash": "h1"}])

        conn = site_store._get_conn()
        row = conn.execute(
            "SELECT fail_count FROM website_urls WHERE url = ?",
            ("https://example.com/flaky",),
        ).fetchone()
        assert row["fail_count"] == 0

    def test_increment_fail_count_sets_last_crawled_at_for_session_scoping(self, site_store):
        import time

        site_store.save_discovered_urls([{"url": "https://example.com/fail"}])
        cutoff = time.time()

        # Increment fail count (sets last_crawled_at to now, which is after cutoff)
        site_store.increment_fail_count(["https://example.com/fail"])

        # URL should no longer appear in this scan session
        needing = site_store.get_urls_needing_recrawl(limit=10, crawled_before=cutoff)
        assert needing == []

    def test_get_total_count(self, site_store):
        assert site_store.get_total_count() == 0

        site_store.save_discovered_urls([{"url": "https://example.com/a"}])
        # No hash yet, so count is still 0
        assert site_store.get_total_count() == 0

        site_store.update_content_hashes([{"url": "https://example.com/a", "content_hash": "h1"}])
        assert site_store.get_total_count() == 1

    def test_get_total_count_with_status(self, site_store):
        site_store.save_discovered_urls(
            [
                {"url": "https://example.com/a"},
                {"url": "https://example.com/b"},
            ]
        )
        site_store.update_content_hashes(
            [
                {"url": "https://example.com/a", "content_hash": "ha", "status": "active"},
                {"url": "https://example.com/b", "content_hash": "hb", "status": "active"},
            ]
        )
        site_store.mark_urls_deleted(["https://example.com/a"])

        assert site_store.get_total_count(status="deleted") == 1
        assert site_store.get_total_count(status="active") == 1

    def test_update_content_hashes_with_page_data(self, site_store):
        site_store.save_discovered_urls([{"url": "https://example.com/page"}])

        site_store.update_content_hashes(
            [
                {
                    "url": "https://example.com/page",
                    "content_hash": "sha256abc",
                    "status": "active",
                    "title": "Test Page",
                    "content": "# Hello World\n\nSome content here.",
                    "word_count": 5,
                    "metadata": '{"author": "test"}',
                    "structured_data": '{"og:title": "Test"}',
                },
            ]
        )

        cached = site_store.get_cached_pages(["https://example.com/page"])
        assert len(cached) == 1
        assert cached[0]["url"] == "https://example.com/page"
        assert cached[0]["title"] == "Test Page"
        assert cached[0]["content"] == "# Hello World\n\nSome content here."
        assert cached[0]["word_count"] == 5
        assert cached[0]["metadata"] == {"author": "test"}
        assert cached[0]["structured_data"] == {"og:title": "Test"}

    def test_update_content_hashes_without_page_data(self, site_store):
        site_store.save_discovered_urls([{"url": "https://example.com/page"}])

        site_store.update_content_hashes([{"url": "https://example.com/page", "content_hash": "sha256abc"}])

        cached = site_store.get_cached_pages(["https://example.com/page"])
        assert len(cached) == 0

    def test_get_cached_pages_hit(self, site_store):
        site_store.save_discovered_urls([{"url": "https://example.com/a"}])
        site_store.update_content_hashes(
            [
                {
                    "url": "https://example.com/a",
                    "content_hash": "h1",
                    "content": "Page A content",
                    "title": "Page A",
                    "word_count": 3,
                },
            ]
        )

        cached = site_store.get_cached_pages(["https://example.com/a"])
        assert len(cached) == 1
        assert cached[0]["content"] == "Page A content"
        assert cached[0]["title"] == "Page A"

    def test_get_cached_pages_miss(self, site_store):
        cached = site_store.get_cached_pages(["https://example.com/nonexistent"])
        assert len(cached) == 0

    def test_get_cached_pages_mixed(self, site_store):
        site_store.save_discovered_urls([{"url": "https://example.com/a"}, {"url": "https://example.com/b"}])
        site_store.update_content_hashes(
            [
                {
                    "url": "https://example.com/a",
                    "content_hash": "h1",
                    "content": "Page A",
                    "word_count": 2,
                },
                {"url": "https://example.com/b", "content_hash": "h2"},
            ]
        )

        cached = site_store.get_cached_pages(
            ["https://example.com/a", "https://example.com/b", "https://example.com/c"]
        )
        assert len(cached) == 1
        assert cached[0]["url"] == "https://example.com/a"

    def test_get_cached_pages_empty_input(self, site_store):
        assert site_store.get_cached_pages([]) == []

    def test_get_cached_pages_null_metadata(self, site_store):
        site_store.save_discovered_urls([{"url": "https://example.com/a"}])
        site_store.update_content_hashes(
            [
                {
                    "url": "https://example.com/a",
                    "content_hash": "h1",
                    "content": "Some content",
                    "word_count": 2,
                },
            ]
        )

        cached = site_store.get_cached_pages(["https://example.com/a"])
        assert cached[0]["metadata"] is None
        assert cached[0]["structured_data"] is None

    def test_close_and_reopen(self, tmp_path):
        db_path = tmp_path / "test.db"
        store = WebsiteStore(db_path)
        store.save_discovered_urls([{"url": "https://example.com/persist"}])
        store.update_content_hashes([{"url": "https://example.com/persist", "content_hash": "h1"}])
        store.close()

        store2 = WebsiteStore(db_path)
        assert store2.get_total_count() == 1
        pages = store2.get_urls_page()
        assert pages[0]["url"] == "https://example.com/persist"
        store2.close()

    def test_schema_migration_adds_fail_count(self, tmp_path):
        db_path = tmp_path / "legacy_fc.db"
        import sqlite3

        conn = sqlite3.connect(str(db_path))
        conn.executescript("""
            CREATE TABLE website_urls (
                url TEXT PRIMARY KEY,
                content_hash TEXT,
                status TEXT NOT NULL DEFAULT 'discovered',
                last_crawled_at REAL,
                discovered_at REAL NOT NULL,
                title TEXT,
                content TEXT,
                word_count INTEGER,
                metadata TEXT,
                structured_data TEXT
            );
        """)
        conn.execute(
            "INSERT INTO website_urls (url, discovered_at) VALUES (?, ?)",
            ("https://example.com/old", 1000.0),
        )
        conn.commit()
        conn.close()

        store = WebsiteStore(db_path)
        # fail_count column should exist after migration
        c = store._get_conn()
        row = c.execute(
            "SELECT fail_count FROM website_urls WHERE url = ?",
            ("https://example.com/old",),
        ).fetchone()
        assert row["fail_count"] == 0
        store.close()

    def test_schema_migration_adds_columns(self, tmp_path):
        db_path = tmp_path / "legacy.db"
        import sqlite3

        conn = sqlite3.connect(str(db_path))
        conn.executescript("""
            CREATE TABLE website_urls (
                url TEXT PRIMARY KEY,
                content_hash TEXT,
                status TEXT NOT NULL DEFAULT 'discovered',
                last_crawled_at REAL,
                discovered_at REAL NOT NULL
            );
        """)
        conn.execute(
            "INSERT INTO website_urls (url, discovered_at) VALUES (?, ?)",
            ("https://example.com/old", 1000.0),
        )
        conn.commit()
        conn.close()

        store = WebsiteStore(db_path)
        store.update_content_hashes(
            [
                {
                    "url": "https://example.com/old",
                    "content_hash": "h1",
                    "content": "Migrated content",
                    "title": "Old Page",
                    "word_count": 2,
                },
            ]
        )
        cached = store.get_cached_pages(["https://example.com/old"])
        assert len(cached) == 1
        assert cached[0]["content"] == "Migrated content"
        assert cached[0]["title"] == "Old Page"
        store.close()


class TestWebsiteStoreManager:
    def test_register_website(self, manager):
        result = manager.register_website("https://example.com/", scan_interval=3600)
        assert result["url"] == "https://example.com/"
        assert result["domain"] == "example.com"
        assert result["path_prefix"] == "/"
        assert result["scan_interval"] == 3600

        website = manager.get_website("https://example.com/")
        assert website is not None
        assert website["url"] == "https://example.com/"
        assert website["scan_interval"] == 3600
        assert website["status"] == "idle"

    def test_register_website_normalizes_bare_domain(self, manager):
        result = manager.register_website("example.com", scan_interval=3600)
        assert result["url"] == "https://example.com/"
        assert result["domain"] == "example.com"
        assert result["path_prefix"] == "/"

        website = manager.get_website("example.com")
        assert website is not None
        assert website["url"] == "https://example.com/"

    def test_register_website_with_path(self, manager):
        result = manager.register_website("https://docs.python.org/3.12/")
        assert result["url"] == "https://docs.python.org/3.12/"
        assert result["domain"] == "docs.python.org"
        assert result["path_prefix"] == "/3.12/"

    def test_register_website_upsert(self, manager):
        manager.register_website("https://example.com/", scan_interval=3600)
        manager.register_website("https://example.com/", scan_interval=7200)

        website = manager.get_website("https://example.com/")
        assert website["scan_interval"] == 7200

    def test_register_multiple_paths_same_domain(self, manager):
        manager.register_website("https://docs.python.org/3.12/")
        manager.register_website("https://docs.python.org/3.13/")

        w1 = manager.get_website("https://docs.python.org/3.12/")
        w2 = manager.get_website("https://docs.python.org/3.13/")
        assert w1 is not None
        assert w2 is not None
        assert w1["url"] != w2["url"]

    def test_remove_website(self, manager, tmp_data_dir):
        manager.register_website("https://example.com/")
        site_store = manager.get_site_store("https://example.com/")
        site_store.save_discovered_urls([{"url": "https://example.com/a"}])

        db_file = tmp_data_dir / "sites" / "example_com.db"
        assert db_file.exists()

        removed = manager.remove_website("https://example.com/")
        assert removed is True
        assert not db_file.exists()
        assert manager.get_website("https://example.com/") is None

    def test_remove_website_with_path(self, manager, tmp_data_dir):
        manager.register_website("https://docs.python.org/3.12/")
        site_store = manager.get_site_store("https://docs.python.org/3.12/")
        site_store.save_discovered_urls([{"url": "https://docs.python.org/3.12/tutorial"}])

        db_file = tmp_data_dir / "sites" / "docs_python_org__3_12.db"
        assert db_file.exists()

        removed = manager.remove_website("https://docs.python.org/3.12/")
        assert removed is True
        assert not db_file.exists()

    def test_remove_website_not_found(self, manager):
        removed = manager.remove_website("https://nonexistent.com/")
        assert removed is False

    def test_get_due_websites_none_scanned(self, manager):
        manager.register_website("https://a.com/")
        manager.register_website("https://b.com/")

        due = manager.get_due_websites()
        urls = [w["url"] for w in due]
        assert "https://a.com/" in urls
        assert "https://b.com/" in urls

    def test_get_due_websites_excludes_scanning(self, manager):
        manager.register_website("https://a.com/")
        manager.update_scan_status("https://a.com/", "scanning")

        due = manager.get_due_websites()
        assert len(due) == 0

    def test_get_due_websites_excludes_recently_scanned(self, manager):
        manager.register_website("https://a.com/", scan_interval=3600)
        manager.update_last_scanned("https://a.com/")

        due = manager.get_due_websites()
        assert len(due) == 0

    def test_get_due_websites_returns_domain_and_path(self, manager):
        manager.register_website("https://docs.python.org/3.12/")
        due = manager.get_due_websites()
        assert len(due) == 1
        assert due[0]["url"] == "https://docs.python.org/3.12/"
        assert due[0]["domain"] == "docs.python.org"
        assert due[0]["path_prefix"] == "/3.12/"

    def test_update_scan_status(self, manager):
        manager.register_website("https://a.com/")
        manager.update_scan_status("https://a.com/", "error", error="timeout")

        website = manager.get_website("https://a.com/")
        assert website["status"] == "error"
        assert website["error"] == "timeout"

    def test_update_scan_status_clears_error(self, manager):
        manager.register_website("https://a.com/")
        manager.update_scan_status("https://a.com/", "error", error="timeout")
        manager.update_scan_status("https://a.com/", "idle")

        website = manager.get_website("https://a.com/")
        assert website["status"] == "idle"
        assert website["error"] is None

    def test_get_site_store_creates_and_caches(self, manager):
        manager.register_website("https://example.com/")
        store1 = manager.get_site_store("https://example.com/")
        store2 = manager.get_site_store("https://example.com/")
        assert store1 is store2

    def test_get_site_store_different_urls(self, manager):
        store_a = manager.get_site_store("https://a.com/")
        store_b = manager.get_site_store("https://b.com/")
        assert store_a is not store_b

    def test_site_store_isolation(self, manager):
        store_a = manager.get_site_store("https://a.com/")
        store_b = manager.get_site_store("https://b.com/")

        store_a.save_discovered_urls([{"url": "https://a.com/page"}])
        store_a.update_content_hashes([{"url": "https://a.com/page", "content_hash": "ha"}])

        store_b.save_discovered_urls([{"url": "https://b.com/page1"}, {"url": "https://b.com/page2"}])
        store_b.update_content_hashes(
            [
                {"url": "https://b.com/page1", "content_hash": "hb1"},
                {"url": "https://b.com/page2", "content_hash": "hb2"},
            ]
        )

        assert store_a.get_total_count() == 1
        assert store_b.get_total_count() == 2

    def test_get_website_not_found(self, manager):
        assert manager.get_website("https://nonexistent.com/") is None

    def test_close_all(self, manager):
        manager.register_website("https://a.com/")
        manager.get_site_store("https://a.com/")

        manager.close_all()
        # After close_all, internal state should be cleared
        assert len(manager._stores) == 0
        assert manager._main_conn is None

    def test_removes_wal_and_shm_files(self, manager, tmp_data_dir):
        manager.register_website("https://example.com/")
        site_store = manager.get_site_store("https://example.com/")
        site_store.save_discovered_urls([{"url": "https://example.com/a"}])

        db_file = tmp_data_dir / "sites" / "example_com.db"
        # WAL files may or may not exist depending on SQLite behavior,
        # but remove_website should handle them gracefully
        manager.remove_website("https://example.com/")
        assert not db_file.exists()
        assert not db_file.with_suffix(".db-wal").exists()
        assert not db_file.with_suffix(".db-shm").exists()

    def test_get_cached_pages_registered_website(self, manager):
        manager.register_website("https://example.com/")
        store = manager.get_site_store("https://example.com/")
        store.save_discovered_urls([{"url": "https://example.com/page"}])
        store.update_content_hashes(
            [
                {
                    "url": "https://example.com/page",
                    "content_hash": "h1",
                    "content": "Cached content",
                    "title": "Cached",
                    "word_count": 2,
                },
            ]
        )

        cached, to_crawl = manager.get_cached_pages(["https://example.com/page"])
        assert len(cached) == 1
        assert cached[0]["content"] == "Cached content"
        assert len(to_crawl) == 0

    def test_get_cached_pages_unregistered_domain(self, manager):
        cached, to_crawl = manager.get_cached_pages(["https://unknown.com/page"])
        assert len(cached) == 0
        assert to_crawl == ["https://unknown.com/page"]

    def test_get_cached_pages_mixed_domains(self, manager):
        manager.register_website("https://a.com/")
        store = manager.get_site_store("https://a.com/")
        store.save_discovered_urls([{"url": "https://a.com/page"}])
        store.update_content_hashes(
            [
                {
                    "url": "https://a.com/page",
                    "content_hash": "h1",
                    "content": "Page A",
                    "word_count": 2,
                },
            ]
        )

        cached, to_crawl = manager.get_cached_pages(["https://a.com/page", "https://b.com/other"])
        assert len(cached) == 1
        assert cached[0]["url"] == "https://a.com/page"
        assert to_crawl == ["https://b.com/other"]

    def test_get_cached_pages_cache_miss_on_registered_website(self, manager):
        manager.register_website("https://example.com/")
        store = manager.get_site_store("https://example.com/")
        store.save_discovered_urls([{"url": "https://example.com/a"}])
        # Hash only, no content
        store.update_content_hashes([{"url": "https://example.com/a", "content_hash": "h1"}])

        cached, to_crawl = manager.get_cached_pages(["https://example.com/a"])
        assert len(cached) == 0
        assert to_crawl == ["https://example.com/a"]

    def test_get_cached_pages_path_prefix_matching(self, manager):
        """URLs should match the registered base URL by path prefix."""
        manager.register_website("https://docs.python.org/3.12/")
        store = manager.get_site_store("https://docs.python.org/3.12/")
        store.save_discovered_urls([{"url": "https://docs.python.org/3.12/tutorial"}])
        store.update_content_hashes(
            [
                {
                    "url": "https://docs.python.org/3.12/tutorial",
                    "content_hash": "h1",
                    "content": "Tutorial content",
                    "word_count": 2,
                },
            ]
        )

        cached, to_crawl = manager.get_cached_pages(["https://docs.python.org/3.12/tutorial"])
        assert len(cached) == 1
        assert cached[0]["content"] == "Tutorial content"

    def test_get_cached_pages_path_prefix_no_match(self, manager):
        """URLs outside the registered path prefix should not match."""
        manager.register_website("https://docs.python.org/3.12/")

        cached, to_crawl = manager.get_cached_pages(["https://docs.python.org/3.13/tutorial"])
        assert len(cached) == 0
        assert to_crawl == ["https://docs.python.org/3.13/tutorial"]

    def test_get_cached_pages_longest_prefix_wins(self, manager):
        """When multiple registrations match, the longest path prefix should win."""
        manager.register_website("https://example.com/")
        manager.register_website("https://example.com/docs/")

        store_docs = manager.get_site_store("https://example.com/docs/")
        store_docs.save_discovered_urls([{"url": "https://example.com/docs/page"}])
        store_docs.update_content_hashes(
            [
                {
                    "url": "https://example.com/docs/page",
                    "content_hash": "h1",
                    "content": "Docs page",
                    "word_count": 2,
                },
            ]
        )

        cached, to_crawl = manager.get_cached_pages(["https://example.com/docs/page"])
        assert len(cached) == 1
        assert cached[0]["content"] == "Docs page"

    def test_get_cached_pages_empty_input(self, manager):
        cached, to_crawl = manager.get_cached_pages([])
        assert cached == []
        assert to_crawl == []

    def test_schema_migration_domain_to_url(self, tmp_data_dir):
        """Test migration from old domain-based schema to url-based schema."""
        import sqlite3

        main_db = tmp_data_dir / "crawler.db"
        tmp_data_dir.mkdir(parents=True, exist_ok=True)
        (tmp_data_dir / "sites").mkdir(parents=True, exist_ok=True)

        conn = sqlite3.connect(str(main_db))
        conn.execute("PRAGMA journal_mode=WAL")
        conn.row_factory = sqlite3.Row
        conn.executescript("""
            CREATE TABLE websites (
                domain TEXT PRIMARY KEY,
                status TEXT NOT NULL DEFAULT 'idle',
                scan_interval INTEGER NOT NULL DEFAULT 21600,
                last_scanned_at REAL,
                error TEXT,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            );
        """)
        conn.execute(
            "INSERT INTO websites (domain, status, scan_interval, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            ("example.com", "idle", 3600, 1000.0, 1000.0),
        )
        conn.commit()
        conn.close()

        mgr = WebsiteStoreManager(data_dir=tmp_data_dir)

        website = mgr.get_website("https://example.com/")
        assert website is not None
        assert website["url"] == "https://example.com/"
        assert website["domain"] == "example.com"
        assert website["path_prefix"] == "/"
        assert website["scan_interval"] == 3600

        mgr.close_all()

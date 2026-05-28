from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.routers.websites import router

pytestmark = pytest.mark.asyncio

app = FastAPI()
app.include_router(router)


@pytest.fixture
def mock_manager():
    manager = AsyncMock()
    manager.get_site_store = MagicMock()
    # Default: caller's org has membership (tests that exercise the
    # 404-on-missing-membership path can override this).
    manager.org_has_membership.return_value = True
    app.state.pg_store_manager = manager
    yield manager
    del app.state.pg_store_manager


def _website_row(domain="example.com", scan_interval=21600, **overrides):
    return {
        "domain": domain,
        "title": None,
        "description": None,
        "page_count": 0,
        "total_urls": 0,
        "crawled_count": 0,
        "status": "idle",
        "scan_interval": scan_interval,
        "last_scanned_at": None,
        "error": None,
        "created_at": None,
        "updated_at": None,
        **overrides,
    }


class TestRegisterWebsite:
    async def test_success_first_membership_triggers_scan(self, mock_manager):
        mock_manager.get_website.return_value = None
        mock_manager.register_website.return_value = {
            "domain": "example.com",
            "status": "idle",
            "scan_interval": 21600,
            "first_membership": True,
        }

        with patch("app.routers.websites.trigger_scan") as mock_trigger:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                response = await client.post(
                    "/api/v1/websites",
                    json={"domain": "example.com", "scan_interval": 21600},
                )

        assert response.status_code == 200
        data = response.json()
        assert data["domain"] == "example.com"
        assert data["status"] == "scanning"
        mock_manager.register_website.assert_awaited_once_with(
            domain="example.com",
            scan_interval=21600,
            org_slug="test-org",
        )
        mock_trigger.assert_called_once()

    async def test_second_org_joining_does_not_retrigger_scan(self, mock_manager):
        """If the domain is already tracked by another org, the new
        membership reuses the existing crawl; trigger_scan should NOT fire."""
        mock_manager.get_website.return_value = _website_row(status="active")
        mock_manager.register_website.return_value = {
            "domain": "example.com",
            "status": "idle",
            "scan_interval": 21600,
            "first_membership": False,
        }

        with patch("app.routers.websites.trigger_scan") as mock_trigger:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                response = await client.post(
                    "/api/v1/websites",
                    json={"domain": "example.com", "scan_interval": 21600},
                )

        assert response.status_code == 200
        data = response.json()
        # Status reflects the already-tracked website, not "scanning"
        assert data["status"] == "active"
        mock_trigger.assert_not_called()

    async def test_normalizes_full_url_to_domain(self, mock_manager):
        mock_manager.register_website.return_value = {
            "domain": "www.wisekey.com",
            "status": "idle",
            "scan_interval": 21600,
            "first_membership": True,
        }
        mock_manager.get_website.return_value = _website_row(domain="www.wisekey.com")

        with patch("app.routers.websites.trigger_scan"):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                response = await client.post(
                    "/api/v1/websites",
                    json={"domain": "https://www.wisekey.com", "scan_interval": 21600},
                )

        assert response.status_code == 200
        mock_manager.register_website.assert_awaited_once_with(
            domain="www.wisekey.com",
            scan_interval=21600,
            org_slug="test-org",
        )

    async def test_409_when_domain_is_deleting(self, mock_manager):
        mock_manager.get_website.return_value = _website_row(status="deleting")

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post(
                "/api/v1/websites",
                json={"domain": "example.com"},
            )

        assert response.status_code == 409
        assert "currently being deleted" in response.json()["detail"]
        mock_manager.register_website.assert_not_awaited()

    async def test_500_on_error(self, mock_manager):
        mock_manager.get_website.return_value = None
        mock_manager.register_website.side_effect = RuntimeError("db error")

        with patch("app.routers.websites.trigger_scan"):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                response = await client.post(
                    "/api/v1/websites",
                    json={"domain": "example.com"},
                )

        assert response.status_code == 500
        assert response.json()["detail"] == "Failed to register website"


class TestUpdateWebsite:
    async def test_success(self, mock_manager):
        mock_manager.get_website.return_value = _website_row(status="active", scan_interval=21600)

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.patch(
                "/api/v1/websites/example.com",
                json={"scan_interval": 3600},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["domain"] == "example.com"
        assert data["scan_interval"] == 3600
        assert data["status"] == "active"
        mock_manager.update_scan_interval.assert_awaited_once_with(
            domain="example.com",
            scan_interval=3600,
        )

    async def test_404_when_caller_org_has_no_membership(self, mock_manager):
        mock_manager.org_has_membership.return_value = False

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.patch(
                "/api/v1/websites/example.com",
                json={"scan_interval": 3600},
            )

        assert response.status_code == 404
        mock_manager.update_scan_interval.assert_not_awaited()

    async def test_404_when_not_found(self, mock_manager):
        mock_manager.get_website.return_value = None

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.patch(
                "/api/v1/websites/unknown.com",
                json={"scan_interval": 3600},
            )

        assert response.status_code == 404
        assert response.json()["detail"] == "Website not found: unknown.com"
        mock_manager.update_scan_interval.assert_not_awaited()

    async def test_409_when_domain_is_deleting(self, mock_manager):
        mock_manager.get_website.return_value = _website_row(status="deleting")

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.patch(
                "/api/v1/websites/example.com",
                json={"scan_interval": 3600},
            )

        assert response.status_code == 409
        assert "currently being deleted" in response.json()["detail"]
        mock_manager.update_scan_interval.assert_not_awaited()


class TestGetWebsiteInfo:
    async def test_success(self, mock_manager):
        mock_manager.get_website.return_value = {
            "domain": "example.com",
            "title": "Example",
            "description": "An example site",
            "page_count": 42,
            "total_urls": 50,
            "crawled_count": 42,
            "status": "active",
            "scan_interval": 3600,
            "last_scanned_at": 1700000000.0,
            "error": None,
            "created_at": 1699000000.0,
            "updated_at": 1700000000.0,
        }

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/v1/websites/example.com")

        assert response.status_code == 200
        data = response.json()
        assert data["domain"] == "example.com"
        assert data["title"] == "Example"
        assert data["status"] == "active"

    async def test_404_when_caller_org_has_no_membership(self, mock_manager):
        mock_manager.org_has_membership.return_value = False

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/v1/websites/example.com")

        assert response.status_code == 404
        mock_manager.get_website.assert_not_awaited()

    async def test_404_when_not_found(self, mock_manager):
        mock_manager.get_website.return_value = None

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/v1/websites/unknown.com")

        assert response.status_code == 404
        assert response.json()["detail"] == "Website not found: unknown.com"


class TestDeregisterWebsite:
    async def test_removes_website_when_last_membership(self, mock_manager):
        mock_manager.begin_delete.return_value = {
            "removed_membership": True,
            "removed_website": True,
        }

        with patch("app.routers.websites._spawn_delete_task") as mock_spawn:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                response = await client.delete("/api/v1/websites/example.com")

        assert response.status_code == 202
        data = response.json()
        assert data["domain"] == "example.com"
        assert data["status"] == "deleting"
        mock_manager.begin_delete.assert_awaited_once_with("example.com", "test-org")
        mock_spawn.assert_called_once_with(mock_manager, "example.com")

    async def test_membership_only_when_other_orgs_remain(self, mock_manager):
        """Other orgs still track this domain: only the caller's membership
        is removed; website data and crawl schedule stay intact."""
        mock_manager.begin_delete.return_value = {
            "removed_membership": True,
            "removed_website": False,
        }

        with patch("app.routers.websites._spawn_delete_task") as mock_spawn:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                response = await client.delete("/api/v1/websites/example.com")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "membership_removed"
        # Importantly: no background delete task — data must survive.
        mock_spawn.assert_not_called()

    async def test_404_when_caller_never_had_membership(self, mock_manager):
        mock_manager.begin_delete.return_value = {
            "removed_membership": False,
            "removed_website": False,
        }

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.delete("/api/v1/websites/unknown.com")

        assert response.status_code == 404
        assert response.json()["detail"] == "Website not found: unknown.com"

    async def test_500_on_error(self, mock_manager):
        mock_manager.begin_delete.side_effect = RuntimeError("db error")

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.delete("/api/v1/websites/example.com")

        assert response.status_code == 500
        assert response.json()["detail"] == "Failed to deregister website"


class TestGetWebsiteUrls:
    async def test_success_with_pagination(self, mock_manager):
        mock_manager.get_website.return_value = {"domain": "example.com"}
        mock_site_store = AsyncMock()
        mock_manager.get_site_store.return_value = mock_site_store
        mock_site_store.get_urls_page.return_value = [
            {
                "url": "https://example.com/page1",
                "content_hash": "abc123",
                "status": "active",
                "last_crawled_at": 1700000000.0,
            },
        ]
        mock_site_store.get_total_count.return_value = 50

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/v1/websites/example.com/urls?offset=0&limit=2")

        assert response.status_code == 200
        data = response.json()
        assert data["domain"] == "example.com"
        assert data["total"] == 50

    async def test_404_when_caller_org_has_no_membership(self, mock_manager):
        mock_manager.org_has_membership.return_value = False

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/v1/websites/example.com/urls")

        assert response.status_code == 404

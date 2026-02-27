from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.routers.websites import router

app = FastAPI()
app.include_router(router)


@pytest.fixture
def mock_manager():
    manager = AsyncMock()
    manager.get_site_store = MagicMock()
    app.state.pg_store_manager = manager
    yield manager
    del app.state.pg_store_manager


class TestRegisterWebsite:
    async def test_success(self, mock_manager):
        mock_manager.register_website.return_value = {
            "domain": "example.com",
            "status": "idle",
            "scan_interval": 21600,
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
        assert data["status"] == "idle"
        assert data["scan_interval"] == 21600
        mock_manager.register_website.assert_awaited_once_with(
            domain="example.com",
            scan_interval=21600,
        )
        mock_trigger.assert_called_once()

    async def test_uses_default_scan_interval(self, mock_manager):
        mock_manager.register_website.return_value = {
            "domain": "example.com",
            "status": "idle",
            "scan_interval": 21600,
        }

        with patch("app.routers.websites.trigger_scan"):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                response = await client.post(
                    "/api/v1/websites",
                    json={"domain": "example.com"},
                )

        assert response.status_code == 200
        mock_manager.register_website.assert_awaited_once_with(
            domain="example.com",
            scan_interval=21600,
        )

    async def test_500_on_error(self, mock_manager):
        mock_manager.register_website.side_effect = RuntimeError("db error")

        with patch("app.routers.websites.trigger_scan"):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                response = await client.post(
                    "/api/v1/websites",
                    json={"domain": "example.com"},
                )

        assert response.status_code == 500
        assert response.json()["detail"] == "Failed to register website"


class TestGetWebsiteInfo:
    async def test_success(self, mock_manager):
        mock_manager.get_website.return_value = {
            "domain": "example.com",
            "title": "Example",
            "description": "An example site",
            "page_count": 42,
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
        assert data["description"] == "An example site"
        assert data["page_count"] == 42
        assert data["status"] == "active"
        assert data["scan_interval"] == 3600
        assert data["last_scanned_at"] is not None
        assert data["error"] is None
        assert data["created_at"] is not None
        assert data["updated_at"] is not None
        mock_manager.get_website.assert_awaited_once_with("example.com")

    async def test_404_when_not_found(self, mock_manager):
        mock_manager.get_website.return_value = None

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/v1/websites/unknown.com")

        assert response.status_code == 404
        assert response.json()["detail"] == "Website not found: unknown.com"

    async def test_500_on_error(self, mock_manager):
        mock_manager.get_website.side_effect = RuntimeError("db error")

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/v1/websites/example.com")

        assert response.status_code == 500
        assert response.json()["detail"] == "Failed to get website info"


class TestDeregisterWebsite:
    async def test_success(self, mock_manager):
        mock_manager.remove_website.return_value = True

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.delete("/api/v1/websites/example.com")

        assert response.status_code == 200
        data = response.json()
        assert data["domain"] == "example.com"
        assert data["deleted"] is True
        mock_manager.remove_website.assert_awaited_once_with("example.com")

    async def test_404_when_not_found(self, mock_manager):
        mock_manager.remove_website.return_value = False

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.delete("/api/v1/websites/unknown.com")

        assert response.status_code == 404
        assert response.json()["detail"] == "Website not found: unknown.com"

    async def test_500_on_error(self, mock_manager):
        mock_manager.remove_website.side_effect = RuntimeError("db error")

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
            {
                "url": "https://example.com/page2",
                "content_hash": "def456",
                "status": "active",
                "last_crawled_at": 1700001000.0,
            },
        ]
        mock_site_store.get_total_count.return_value = 50

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/v1/websites/example.com/urls?offset=0&limit=2")

        assert response.status_code == 200
        data = response.json()
        assert data["domain"] == "example.com"
        assert len(data["urls"]) == 2
        assert data["urls"][0]["url"] == "https://example.com/page1"
        assert data["urls"][0]["content_hash"] == "abc123"
        assert data["urls"][1]["url"] == "https://example.com/page2"
        assert data["total"] == 50
        assert data["offset"] == 0
        assert data["has_more"] is True
        mock_site_store.get_urls_page.assert_awaited_once_with(offset=0, limit=2, status=None)
        mock_site_store.get_total_count.assert_awaited_once_with(status=None)

    async def test_has_more_false_when_at_end(self, mock_manager):
        mock_manager.get_website.return_value = {"domain": "example.com"}
        mock_site_store = AsyncMock()
        mock_manager.get_site_store.return_value = mock_site_store
        mock_site_store.get_urls_page.return_value = [
            {
                "url": "https://example.com/last",
                "content_hash": "xyz",
                "status": "active",
                "last_crawled_at": None,
            },
        ]
        mock_site_store.get_total_count.return_value = 1

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/v1/websites/example.com/urls?offset=0&limit=100")

        assert response.status_code == 200
        data = response.json()
        assert data["has_more"] is False
        assert data["total"] == 1

    async def test_status_filter(self, mock_manager):
        mock_manager.get_website.return_value = {"domain": "example.com"}
        mock_site_store = AsyncMock()
        mock_manager.get_site_store.return_value = mock_site_store
        mock_site_store.get_urls_page.return_value = []
        mock_site_store.get_total_count.return_value = 0

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/v1/websites/example.com/urls?status=active")

        assert response.status_code == 200
        mock_site_store.get_urls_page.assert_awaited_once_with(offset=0, limit=100, status="active")
        mock_site_store.get_total_count.assert_awaited_once_with(status="active")

    async def test_404_when_website_not_found(self, mock_manager):
        mock_manager.get_website.return_value = None

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/v1/websites/unknown.com/urls")

        assert response.status_code == 404
        assert response.json()["detail"] == "Website not found: unknown.com"

    async def test_500_on_error(self, mock_manager):
        mock_manager.get_website.side_effect = RuntimeError("db error")

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/v1/websites/example.com/urls")

        assert response.status_code == 500
        assert response.json()["detail"] == "Failed to get website URLs"

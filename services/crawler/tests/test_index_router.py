from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.routers.index import router, set_indexing_service

app = FastAPI()
app.include_router(router)


@pytest.fixture
def mock_indexing_service():
    service = AsyncMock()
    set_indexing_service(service)
    yield service
    set_indexing_service(None)


class TestIndexPage:
    async def test_success(self, mock_indexing_service):
        mock_indexing_service.index_page.return_value = {
            "url": "https://example.com/page",
            "status": "indexed",
            "chunks_indexed": 5,
        }

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post(
                "/api/v1/index/page",
                json={
                    "domain": "example.com",
                    "url": "https://example.com/page",
                    "title": "Test Page",
                    "content": "Some content to index",
                },
            )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["url"] == "https://example.com/page"
        assert data["chunks_indexed"] == 5
        assert data["status"] == "indexed"
        mock_indexing_service.index_page.assert_awaited_once_with(
            domain="example.com",
            url="https://example.com/page",
            title="Test Page",
            content="Some content to index",
        )

    async def test_skipped_page(self, mock_indexing_service):
        mock_indexing_service.index_page.return_value = {
            "url": "https://example.com/page",
            "status": "skipped",
            "chunks_indexed": 0,
        }

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post(
                "/api/v1/index/page",
                json={"domain": "example.com", "url": "https://example.com/page", "content": "Same content"},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["status"] == "skipped"

    async def test_503_when_service_not_initialized(self):
        set_indexing_service(None)

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post(
                "/api/v1/index/page",
                json={"domain": "example.com", "url": "https://example.com/page", "content": "content"},
            )

        assert response.status_code == 503
        assert response.json()["detail"] == "Indexing service not initialized"

    async def test_500_on_unexpected_error(self, mock_indexing_service):
        mock_indexing_service.index_page.side_effect = RuntimeError("db error")

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post(
                "/api/v1/index/page",
                json={"domain": "example.com", "url": "https://example.com/page", "content": "content"},
            )

        assert response.status_code == 500
        assert response.json()["detail"] == "Indexing failed"


class TestIndexWebsite:
    async def test_success(self, mock_indexing_service):
        mock_indexing_service.index_website.return_value = {
            "domain": "example.com",
            "pages_indexed": 10,
            "pages_skipped": 2,
            "pages_failed": 1,
            "total_chunks": 50,
        }

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/api/v1/index/website/example.com")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["domain"] == "example.com"
        assert data["pages_indexed"] == 10
        assert data["pages_skipped"] == 2
        assert data["pages_failed"] == 1
        assert data["total_chunks"] == 50
        mock_indexing_service.index_website.assert_awaited_once_with("example.com")

    async def test_503_when_service_not_initialized(self):
        set_indexing_service(None)

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/api/v1/index/website/example.com")

        assert response.status_code == 503

    async def test_500_on_unexpected_error(self, mock_indexing_service):
        mock_indexing_service.index_website.side_effect = RuntimeError("boom")

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/api/v1/index/website/example.com")

        assert response.status_code == 500
        assert response.json()["detail"] == "Website indexing failed"

from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.routers.search import router, set_search_service
from app.services.search_service import SearchResult

app = FastAPI()
app.include_router(router)


@pytest.fixture
def mock_search_service():
    service = AsyncMock()
    set_search_service(service)
    yield service
    set_search_service(None)


class TestSearchAll:
    async def test_returns_results(self, mock_search_service):
        mock_search_service.search.return_value = [
            SearchResult(
                url="https://example.com/page1", title="Page 1", chunk_content="Hello world", chunk_index=0, score=0.95
            ),
            SearchResult(
                url="https://example.com/page2",
                title="Page 2",
                chunk_content="Goodbye world",
                chunk_index=1,
                score=0.80,
            ),
        ]

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/api/v1/search", json={"query": "hello", "limit": 10})

        assert response.status_code == 200
        data = response.json()
        assert data["query"] == "hello"
        assert data["total"] == 2
        assert len(data["results"]) == 2
        assert data["results"][0]["url"] == "https://example.com/page1"
        assert data["results"][0]["score"] == 0.95
        mock_search_service.search.assert_awaited_once_with(query="hello", limit=10)

    async def test_returns_empty_results(self, mock_search_service):
        mock_search_service.search.return_value = []

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/api/v1/search", json={"query": "nonexistent"})

        assert response.status_code == 200
        data = response.json()
        assert data["query"] == "nonexistent"
        assert data["total"] == 0
        assert data["results"] == []

    async def test_uses_default_limit(self, mock_search_service):
        mock_search_service.search.return_value = []

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            await client.post("/api/v1/search", json={"query": "test"})

        mock_search_service.search.assert_awaited_once_with(query="test", limit=10)

    async def test_503_when_service_not_initialized(self):
        set_search_service(None)

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/api/v1/search", json={"query": "test"})

        assert response.status_code == 503
        assert response.json()["detail"] == "Search service not initialized"

    async def test_500_on_unexpected_error(self, mock_search_service):
        mock_search_service.search.side_effect = RuntimeError("db gone")

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/api/v1/search", json={"query": "boom"})

        assert response.status_code == 500
        assert response.json()["detail"] == "Search failed"


class TestSearchDomain:
    async def test_routes_domain_correctly(self, mock_search_service):
        mock_search_service.search.return_value = [
            SearchResult(
                url="https://docs.example.com/intro", title="Intro", chunk_content="Welcome", chunk_index=0, score=1.0
            ),
        ]

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/api/v1/search/docs.example.com", json={"query": "welcome", "limit": 5})

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1
        assert data["results"][0]["url"] == "https://docs.example.com/intro"
        mock_search_service.search.assert_awaited_once_with(query="welcome", domain="docs.example.com", limit=5)

    async def test_empty_domain_results(self, mock_search_service):
        mock_search_service.search.return_value = []

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/api/v1/search/unknown.com", json={"query": "anything"})

        assert response.status_code == 200
        assert response.json()["total"] == 0

    async def test_503_when_service_not_initialized(self):
        set_search_service(None)

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/api/v1/search/example.com", json={"query": "test"})

        assert response.status_code == 503

    async def test_500_on_unexpected_error(self, mock_search_service):
        mock_search_service.search.side_effect = RuntimeError("oops")

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/api/v1/search/example.com", json={"query": "fail"})

        assert response.status_code == 500
        assert response.json()["detail"] == "Search failed"

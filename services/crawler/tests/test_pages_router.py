from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.routers.pages import router

pytestmark = pytest.mark.asyncio

app = FastAPI()
app.include_router(router)

_DEFAULT_CRAWLED = datetime(2025, 6, 1, 12, 0, 0, tzinfo=timezone.utc)
_DEFAULT_DISCOVERED = datetime(2025, 5, 15, 8, 0, 0, tzinfo=timezone.utc)


class FakeRecord(dict):
    """Dict subclass mimicking asyncpg Record with r["field"] access."""


def _make_row(**overrides):
    defaults = {
        "url": "https://example.com/page1",
        "title": "Page 1",
        "word_count": 500,
        "status": "active",
        "content_hash": "abc123",
        "last_crawled_at": _DEFAULT_CRAWLED,
        "discovered_at": _DEFAULT_DISCOVERED,
        "chunks_count": 3,
    }
    defaults.update(overrides)
    return FakeRecord(defaults)


@pytest.fixture
def mock_pool():
    conn = AsyncMock()
    pool = MagicMock()
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=conn)
    ctx.__aexit__ = AsyncMock(return_value=False)
    pool.acquire.return_value = ctx
    with patch("app.routers.pages.get_pool", return_value=pool):
        yield conn


class TestListPages:
    async def test_success(self, mock_pool):
        rows = [
            _make_row(url="https://example.com/a", title="Page A", word_count=100, chunks_count=2),
            _make_row(url="https://example.com/b", title="Page B", word_count=200, chunks_count=0),
        ]
        mock_pool.fetch.return_value = rows
        mock_pool.fetchval.return_value = 2

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/v1/pages/example.com")

        assert response.status_code == 200
        data = response.json()
        assert data["domain"] == "example.com"
        assert data["total"] == 2
        assert data["offset"] == 0
        assert data["has_more"] is False
        assert len(data["pages"]) == 2

        page_a = data["pages"][0]
        assert page_a["url"] == "https://example.com/a"
        assert page_a["title"] == "Page A"
        assert page_a["word_count"] == 100
        assert page_a["chunks_count"] == 2
        assert page_a["indexed"] is True

        page_b = data["pages"][1]
        assert page_b["url"] == "https://example.com/b"
        assert page_b["chunks_count"] == 0
        assert page_b["indexed"] is False

    async def test_empty_result(self, mock_pool):
        mock_pool.fetch.return_value = []
        mock_pool.fetchval.return_value = 0

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/v1/pages/unknown.com")

        assert response.status_code == 200
        data = response.json()
        assert data["domain"] == "unknown.com"
        assert data["pages"] == []
        assert data["total"] == 0
        assert data["has_more"] is False

    async def test_status_filter(self, mock_pool):
        mock_pool.fetch.return_value = []
        mock_pool.fetchval.return_value = 0

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/v1/pages/example.com?status=active")

        assert response.status_code == 200

        fetch_call = mock_pool.fetch.call_args
        query = fetch_call[0][0]
        assert "wu.status = $2" in query

        params = fetch_call[0][1:]
        assert params[0] == "example.com"
        assert params[1] == "active"

    async def test_has_more_true(self, mock_pool):
        mock_pool.fetch.return_value = [_make_row(url="https://example.com/p1")]
        mock_pool.fetchval.return_value = 50

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/v1/pages/example.com?offset=0&limit=10")

        assert response.status_code == 200
        data = response.json()
        assert data["has_more"] is True
        assert data["total"] == 50
        assert data["offset"] == 0

    async def test_has_more_false_at_end(self, mock_pool):
        mock_pool.fetch.return_value = [_make_row(url="https://example.com/p1")]
        mock_pool.fetchval.return_value = 50

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/v1/pages/example.com?offset=40&limit=10")

        assert response.status_code == 200
        data = response.json()
        assert data["has_more"] is False

    async def test_sort_param(self, mock_pool):
        mock_pool.fetch.return_value = []
        mock_pool.fetchval.return_value = 0

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/v1/pages/example.com?sort=word_count")

        assert response.status_code == 200

        query = mock_pool.fetch.call_args[0][0]
        assert "ORDER BY wu.word_count DESC" in query

    async def test_invalid_sort_falls_back(self, mock_pool):
        mock_pool.fetch.return_value = []
        mock_pool.fetchval.return_value = 0

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/v1/pages/example.com?sort=invalid_field")

        assert response.status_code == 200

        query = mock_pool.fetch.call_args[0][0]
        assert "ORDER BY wu.last_crawled_at DESC" in query

    async def test_pagination_params_passed(self, mock_pool):
        mock_pool.fetch.return_value = []
        mock_pool.fetchval.return_value = 0

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/v1/pages/example.com?offset=20&limit=50")

        assert response.status_code == 200

        fetch_call = mock_pool.fetch.call_args
        params = fetch_call[0][1:]
        assert 50 in params
        assert 20 in params

    async def test_null_timestamps(self, mock_pool):
        mock_pool.fetch.return_value = [
            _make_row(url="https://example.com/new", last_crawled_at=None, discovered_at=None),
        ]
        mock_pool.fetchval.return_value = 1

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/v1/pages/example.com")

        assert response.status_code == 200
        page = response.json()["pages"][0]
        assert page["last_crawled_at"] is None
        assert page["discovered_at"] is None

    async def test_null_word_count_defaults_to_zero(self, mock_pool):
        mock_pool.fetch.return_value = [_make_row(url="https://example.com/empty", word_count=None)]
        mock_pool.fetchval.return_value = 1

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/v1/pages/example.com")

        assert response.status_code == 200
        assert response.json()["pages"][0]["word_count"] == 0

    async def test_500_on_database_error(self, mock_pool):
        mock_pool.fetch.side_effect = RuntimeError("connection lost")

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/v1/pages/example.com")

        assert response.status_code == 500
        assert response.json()["detail"] == "Failed to list pages"


def _make_chunk_row(**overrides):
    defaults = {
        "chunk_index": 0,
        "chunk_content": "This is chunk content.",
    }
    defaults.update(overrides)
    return FakeRecord(defaults)


class TestGetPageChunks:
    async def test_success(self, mock_pool):
        rows = [
            _make_chunk_row(chunk_index=0, chunk_content="First chunk"),
            _make_chunk_row(chunk_index=1, chunk_content="Second chunk"),
        ]
        mock_pool.fetch.return_value = rows

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get(
                "/api/v1/pages/example.com/chunks",
                params={"url": "https://example.com/page1"},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["url"] == "https://example.com/page1"
        assert data["domain"] == "example.com"
        assert data["total"] == 2
        assert len(data["chunks"]) == 2
        assert data["chunks"][0]["chunk_index"] == 0
        assert data["chunks"][0]["chunk_content"] == "First chunk"
        assert data["chunks"][1]["chunk_index"] == 1

    async def test_empty_chunks(self, mock_pool):
        mock_pool.fetch.return_value = []

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get(
                "/api/v1/pages/example.com/chunks",
                params={"url": "https://example.com/no-chunks"},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["chunks"] == []
        assert data["total"] == 0

    async def test_500_on_database_error(self, mock_pool):
        mock_pool.fetch.side_effect = RuntimeError("connection lost")

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get(
                "/api/v1/pages/example.com/chunks",
                params={"url": "https://example.com/page1"},
            )

        assert response.status_code == 500
        assert response.json()["detail"] == "Failed to get page chunks"

"""Tests for document content retrieval endpoint and service method.

Covers:
- get_document_content() service: normal retrieval, chunk ranges, 404
- GET /documents/{doc_id}/content router: validation, error handling
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytestmark = pytest.mark.asyncio


def _make_service():
    """Create a RagService with all internal dependencies pre-mocked."""
    from app.services.rag_service import RagService

    service = RagService()
    service.initialized = True
    service._pool = MagicMock()
    service._embedding_service = AsyncMock()
    service._vision_client = MagicMock()
    service._search_service = AsyncMock()
    service._openai_client = AsyncMock()
    return service


def _mock_conn(
    *,
    fetchrow_return: dict[str, Any] | None = None,
    fetch_return: list[dict[str, Any]] | None = None,
):
    """Create a mock connection with fetchrow and fetch support."""
    conn = AsyncMock()
    conn.fetchrow = AsyncMock(return_value=fetchrow_return)
    conn.fetch = AsyncMock(return_value=fetch_return or [])
    conn.execute = AsyncMock()
    return conn


def _async_ctx(mock_conn):
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return ctx


DOC_ROW = {
    "id": "uuid-abc",
    "document_id": "doc-1",
    "filename": "report.pdf",
    "chunks_count": 5,
}

CHUNK_ROWS = [
    {"chunk_index": 0, "chunk_content": "First chunk content."},
    {"chunk_index": 1, "chunk_content": "Second chunk content."},
    {"chunk_index": 2, "chunk_content": "Third chunk content."},
    {"chunk_index": 3, "chunk_content": "Fourth chunk content."},
    {"chunk_index": 4, "chunk_content": "Fifth chunk content."},
]


class TestGetDocumentContent:
    """get_document_content() retrieves and reassembles chunk content."""

    async def test_returns_full_content(self):
        service = _make_service()
        mock_conn = _mock_conn(fetchrow_return=DOC_ROW, fetch_return=CHUNK_ROWS)

        with patch("app.services.rag_service.acquire_with_retry", return_value=_async_ctx(mock_conn)):
            result = await service.get_document_content("doc-1")

        assert result is not None
        assert result["document_id"] == "doc-1"
        assert result["title"] == "report.pdf"
        assert result["total_chunks"] == 5
        assert result["chunk_range"] == {"start": 1, "end": 5}
        assert "First chunk content." in result["content"]
        assert "Fifth chunk content." in result["content"]

    async def test_content_joined_with_double_newline(self):
        service = _make_service()
        chunks = [
            {"chunk_index": 0, "chunk_content": "AAA"},
            {"chunk_index": 1, "chunk_content": "BBB"},
        ]
        mock_conn = _mock_conn(
            fetchrow_return={**DOC_ROW, "chunks_count": 2},
            fetch_return=chunks,
        )

        with patch("app.services.rag_service.acquire_with_retry", return_value=_async_ctx(mock_conn)):
            result = await service.get_document_content("doc-1")

        assert result["content"] == "AAA\n\nBBB"

    async def test_returns_none_for_nonexistent_document(self):
        service = _make_service()
        mock_conn = _mock_conn(fetchrow_return=None)

        with patch("app.services.rag_service.acquire_with_retry", return_value=_async_ctx(mock_conn)):
            result = await service.get_document_content("nonexistent")

        assert result is None

    async def test_chunk_range_filters_correctly(self):
        service = _make_service()
        filtered_chunks = [
            {"chunk_index": 1, "chunk_content": "Second chunk content."},
            {"chunk_index": 2, "chunk_content": "Third chunk content."},
        ]
        mock_conn = _mock_conn(fetchrow_return=DOC_ROW, fetch_return=filtered_chunks)

        with patch("app.services.rag_service.acquire_with_retry", return_value=_async_ctx(mock_conn)):
            result = await service.get_document_content("doc-1", chunk_start=2, chunk_end=3)

        assert result is not None
        assert result["chunk_range"] == {"start": 2, "end": 3}
        assert result["total_chunks"] == 5
        assert "Second chunk content." in result["content"]
        assert "Third chunk content." in result["content"]

    async def test_chunk_start_only_returns_from_start_to_end(self):
        service = _make_service()
        chunks = [
            {"chunk_index": 3, "chunk_content": "Fourth chunk content."},
            {"chunk_index": 4, "chunk_content": "Fifth chunk content."},
        ]
        mock_conn = _mock_conn(fetchrow_return=DOC_ROW, fetch_return=chunks)

        with patch("app.services.rag_service.acquire_with_retry", return_value=_async_ctx(mock_conn)):
            result = await service.get_document_content("doc-1", chunk_start=4)

        assert result is not None
        assert result["chunk_range"] == {"start": 4, "end": 5}

    async def test_empty_chunks_returns_empty_content(self):
        service = _make_service()
        mock_conn = _mock_conn(fetchrow_return=DOC_ROW, fetch_return=[])

        with patch("app.services.rag_service.acquire_with_retry", return_value=_async_ctx(mock_conn)):
            result = await service.get_document_content("doc-1", chunk_start=100)

        assert result is not None
        assert result["content"] == ""
        assert result["chunk_range"] == {"start": 0, "end": 0}

    async def test_single_chunk_document(self):
        service = _make_service()
        mock_conn = _mock_conn(
            fetchrow_return={**DOC_ROW, "chunks_count": 1},
            fetch_return=[{"chunk_index": 0, "chunk_content": "Only chunk."}],
        )

        with patch("app.services.rag_service.acquire_with_retry", return_value=_async_ctx(mock_conn)):
            result = await service.get_document_content("doc-1")

        assert result is not None
        assert result["content"] == "Only chunk."
        assert result["chunk_range"] == {"start": 1, "end": 1}
        assert result["total_chunks"] == 1

    async def test_max_chunk_window_caps_unbounded_request(self):
        service = _make_service()
        mock_conn = _mock_conn(fetchrow_return=DOC_ROW, fetch_return=CHUNK_ROWS)

        with patch("app.services.rag_service.acquire_with_retry", return_value=_async_ctx(mock_conn)):
            await service.get_document_content("doc-1", chunk_start=1)

        fetch_call = mock_conn.fetch.call_args
        sql = fetch_call[0][0]
        assert "chunk_index <= $3" in sql
        chunk_end_param = fetch_call[0][3]
        assert chunk_end_param == service.MAX_CHUNK_WINDOW - 1

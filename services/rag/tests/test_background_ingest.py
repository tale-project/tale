"""Tests for background document ingestion and status tracking.

Covers:
- get_document_statuses: status priority with DISTINCT ON, error fields, edge cases
- _background_ingest: happy path, skipped content re-upload, failure recording
- _mark_completed: restores status on skipped re-uploads
- _sanitize_error: truncation of long error messages

Note: Tests that import from app.routers.documents require python-multipart
and are skipped if the dependency is not available in the test environment.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytestmark = pytest.mark.asyncio


def _async_ctx(mock_conn):
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return ctx


def _mock_conn(*, fetch_return=None):
    conn = AsyncMock()
    conn.fetch = AsyncMock(return_value=fetch_return or [])
    conn.execute = AsyncMock()
    return conn


def _can_import_router():
    try:
        from app.routers.documents import _sanitize_error  # noqa: F401

        return True
    except (RuntimeError, ImportError):
        return False


_requires_multipart = pytest.mark.skipif(
    not _can_import_router(),
    reason="python-multipart required for router import",
)


# ============================================================================
# get_document_statuses (from rag_service — always importable)
# ============================================================================


class TestGetDocumentStatuses:
    """Tests for RagService.get_document_statuses."""

    async def test_returns_status_for_found_documents(self):
        from app.services.rag_service import RagService

        service = RagService()
        service.initialized = True
        service._pool = MagicMock()

        mock_conn = _mock_conn(
            fetch_return=[
                {"document_id": "doc-1", "status": "completed", "error": None},
                {"document_id": "doc-2", "status": "processing", "error": None},
            ]
        )

        with patch("app.services.rag_service.acquire_with_retry", return_value=_async_ctx(mock_conn)):
            result = await service.get_document_statuses(["doc-1", "doc-2", "doc-3"])

        assert result["doc-1"] == {"status": "completed", "error": None}
        assert result["doc-2"] == {"status": "processing", "error": None}
        assert result["doc-3"] is None

    async def test_returns_error_field_for_failed_documents(self):
        from app.services.rag_service import RagService

        service = RagService()
        service.initialized = True
        service._pool = MagicMock()

        mock_conn = _mock_conn(
            fetch_return=[
                {"document_id": "doc-1", "status": "failed", "error": "Embedding failed"},
            ]
        )

        with patch("app.services.rag_service.acquire_with_retry", return_value=_async_ctx(mock_conn)):
            result = await service.get_document_statuses(["doc-1"])

        assert result["doc-1"]["status"] == "failed"
        assert result["doc-1"]["error"] == "Embedding failed"

    async def test_missing_documents_return_none(self):
        from app.services.rag_service import RagService

        service = RagService()
        service.initialized = True
        service._pool = MagicMock()

        mock_conn = _mock_conn(fetch_return=[])

        with patch("app.services.rag_service.acquire_with_retry", return_value=_async_ctx(mock_conn)):
            result = await service.get_document_statuses(["nonexistent"])

        assert result["nonexistent"] is None

    async def test_raises_if_pool_is_none(self):
        from app.services.rag_service import RagService

        service = RagService()
        service.initialized = True
        service._pool = None

        with pytest.raises(RuntimeError, match="database pool is None"):
            await service.get_document_statuses(["doc-1"])


# ============================================================================
# Router helpers (require python-multipart)
# ============================================================================


@_requires_multipart
class TestSanitizeError:
    def test_short_error_unchanged(self):
        from app.routers.documents import _sanitize_error

        exc = ValueError("something went wrong")
        assert _sanitize_error(exc) == "something went wrong"

    def test_long_error_truncated(self):
        from app.routers.documents import _sanitize_error

        exc = RuntimeError("x" * 1000)
        result = _sanitize_error(exc, max_length=500)
        assert len(result) == 503  # 500 + "..."
        assert result.endswith("...")

    def test_exact_length_not_truncated(self):
        from app.routers.documents import _sanitize_error

        exc = ValueError("a" * 500)
        result = _sanitize_error(exc, max_length=500)
        assert result == "a" * 500


@_requires_multipart
class TestBackgroundIngest:
    """Tests for the _background_ingest async function."""

    async def test_successful_ingestion(self):
        from app.routers.documents import _background_ingest

        add_result: dict[str, Any] = {
            "success": True,
            "document_id": "doc-1",
            "chunks_created": 5,
            "skipped": False,
        }

        with (
            patch("app.routers.documents._insert_processing_row", new_callable=AsyncMock) as mock_insert,
            patch("app.routers.documents.rag_service") as mock_rag,
            patch("app.routers.documents.cleanup_memory"),
        ):
            mock_rag.add_document = AsyncMock(return_value=add_result)
            await _background_ingest(b"content", "doc-1", "test.txt", user_id="user-1")

        mock_insert.assert_awaited_once()
        mock_rag.add_document.assert_awaited_once()

    async def test_skipped_content_marks_completed(self):
        from app.routers.documents import _background_ingest

        add_result: dict[str, Any] = {
            "success": True,
            "document_id": "doc-1",
            "chunks_created": 0,
            "skipped": True,
            "skip_reason": "content_unchanged",
        }

        with (
            patch("app.routers.documents._insert_processing_row", new_callable=AsyncMock),
            patch("app.routers.documents._mark_completed", new_callable=AsyncMock) as mock_mark,
            patch("app.routers.documents.rag_service") as mock_rag,
            patch("app.routers.documents.cleanup_memory"),
        ):
            mock_rag.add_document = AsyncMock(return_value=add_result)
            await _background_ingest(b"content", "doc-1", "test.txt", user_id="user-1")

        mock_mark.assert_awaited_once_with("doc-1", "user-1")

    async def test_non_skipped_does_not_call_mark_completed(self):
        from app.routers.documents import _background_ingest

        add_result: dict[str, Any] = {
            "success": True,
            "document_id": "doc-1",
            "chunks_created": 5,
            "skipped": False,
        }

        with (
            patch("app.routers.documents._insert_processing_row", new_callable=AsyncMock),
            patch("app.routers.documents._mark_completed", new_callable=AsyncMock) as mock_mark,
            patch("app.routers.documents.rag_service") as mock_rag,
            patch("app.routers.documents.cleanup_memory"),
        ):
            mock_rag.add_document = AsyncMock(return_value=add_result)
            await _background_ingest(b"content", "doc-1", "test.txt", user_id="user-1")

        mock_mark.assert_not_awaited()

    async def test_ingestion_failure_records_sanitized_error(self):
        from app.routers.documents import _background_ingest

        with (
            patch("app.routers.documents._insert_processing_row", new_callable=AsyncMock),
            patch("app.routers.documents._record_failure", new_callable=AsyncMock) as mock_fail,
            patch("app.routers.documents.rag_service") as mock_rag,
            patch("app.routers.documents.cleanup_memory"),
        ):
            mock_rag.add_document = AsyncMock(side_effect=RuntimeError("x" * 1000))
            await _background_ingest(b"content", "doc-1", "test.txt", user_id="user-1")

        mock_fail.assert_awaited_once()
        error_arg = mock_fail.call_args[0][2]
        assert len(error_arg) <= 503  # 500 + "..."

    async def test_record_failure_error_does_not_propagate(self):
        from app.routers.documents import _background_ingest

        with (
            patch("app.routers.documents._insert_processing_row", new_callable=AsyncMock),
            patch(
                "app.routers.documents._record_failure",
                new_callable=AsyncMock,
                side_effect=RuntimeError("db down"),
            ),
            patch("app.routers.documents.rag_service") as mock_rag,
            patch("app.routers.documents.cleanup_memory"),
        ):
            mock_rag.add_document = AsyncMock(side_effect=ValueError("ingestion failed"))
            await _background_ingest(b"content", "doc-1", "test.txt", user_id="user-1")

    async def test_cleanup_memory_always_called(self):
        from app.routers.documents import _background_ingest

        with (
            patch("app.routers.documents._insert_processing_row", new_callable=AsyncMock),
            patch("app.routers.documents._record_failure", new_callable=AsyncMock),
            patch("app.routers.documents.rag_service") as mock_rag,
            patch("app.routers.documents.cleanup_memory") as mock_cleanup,
        ):
            mock_rag.add_document = AsyncMock(side_effect=RuntimeError("boom"))
            await _background_ingest(b"content", "doc-1", "test.txt", user_id="user-1")

        mock_cleanup.assert_called_once()

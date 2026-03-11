"""Tests for the file-based document comparison endpoint and service method.

Covers:
- compare_files() service: text extraction, diff, error on empty text
- POST /documents/compare-files router: validation, file extensions, response schema
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

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


class TestCompareFilesService:
    """compare_files() extracts text from bytes and diffs."""

    async def test_returns_diff_result(self):
        service = _make_service()

        async def mock_extract(content_bytes, filename, *, vision_client=None):
            text = content_bytes.decode("utf-8")
            return text, False

        with patch("tale_knowledge.extraction.extract_text", side_effect=mock_extract):
            result = await service.compare_files(
                b"Section 1\n\nOriginal clause.",
                "base.txt",
                b"Section 1\n\nModified clause.",
                "comparison.txt",
            )

        assert result["success"] is True
        assert result["base_document"]["title"] == "base.txt"
        assert result["comparison_document"]["title"] == "comparison.txt"
        assert "change_blocks" in result
        assert "stats" in result

    async def test_identical_files_no_changes(self):
        service = _make_service()
        content = b"Identical content.\n\nParagraph two."

        async def mock_extract(content_bytes, filename, *, vision_client=None):
            return content_bytes.decode("utf-8"), False

        with patch("tale_knowledge.extraction.extract_text", side_effect=mock_extract):
            result = await service.compare_files(
                content,
                "a.txt",
                content,
                "b.txt",
            )

        assert result["success"] is True
        assert result["stats"]["modified"] == 0
        assert result["stats"]["added"] == 0
        assert result["stats"]["deleted"] == 0

    async def test_raises_on_empty_base_text(self):
        service = _make_service()

        async def mock_extract(content_bytes, filename, *, vision_client=None):
            if filename == "empty.txt":
                return "", False
            return "some text", False

        with (
            patch("tale_knowledge.extraction.extract_text", side_effect=mock_extract),
            pytest.raises(ValueError, match="No text could be extracted from base file"),
        ):
            await service.compare_files(
                b"",
                "empty.txt",
                b"content",
                "comparison.txt",
            )

    async def test_raises_on_empty_comparison_text(self):
        service = _make_service()

        async def mock_extract(content_bytes, filename, *, vision_client=None):
            if filename == "empty.txt":
                return "", False
            return "some text", False

        with (
            patch("tale_knowledge.extraction.extract_text", side_effect=mock_extract),
            pytest.raises(ValueError, match="No text could be extracted from comparison file"),
        ):
            await service.compare_files(
                b"content",
                "base.txt",
                b"",
                "empty.txt",
            )


class TestCompareFilesEndpoint:
    """POST /api/v1/documents/compare-files endpoint tests."""

    @staticmethod
    def _get_app():
        from app.main import app

        return app

    async def test_happy_path(self):
        mock_result = {
            "success": True,
            "base_document": {"document_id": "base.txt", "title": "base.txt"},
            "comparison_document": {"document_id": "comp.txt", "title": "comp.txt"},
            "change_blocks": [],
            "stats": {
                "total_paragraphs_base": 2,
                "total_paragraphs_comparison": 2,
                "unchanged": 2,
                "modified": 0,
                "added": 0,
                "deleted": 0,
                "high_divergence": False,
            },
            "truncated": False,
        }

        with patch("app.routers.documents.rag_service") as mock_svc:
            mock_svc.compare_files = AsyncMock(return_value=mock_result)

            transport = ASGITransport(app=self._get_app())
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/v1/documents/compare-files",
                    files={
                        "base_file": ("base.txt", b"Hello\n\nWorld", "text/plain"),
                        "comparison_file": ("comp.txt", b"Hello\n\nEarth", "text/plain"),
                    },
                )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["base_document"]["title"] == "base.txt"

    async def test_unsupported_extension(self):
        with patch("app.routers.documents.rag_service"):
            transport = ASGITransport(app=self._get_app())
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/v1/documents/compare-files",
                    files={
                        "base_file": ("base.exe", b"binary", "application/octet-stream"),
                        "comparison_file": ("comp.txt", b"text", "text/plain"),
                    },
                )

        assert response.status_code == 400
        assert "Unsupported file type" in response.json()["message"]

    async def test_extraction_failure_returns_422(self):
        with patch("app.routers.documents.rag_service") as mock_svc:
            mock_svc.compare_files = AsyncMock(
                side_effect=ValueError("No text could be extracted from base file: empty.pdf"),
            )

            transport = ASGITransport(app=self._get_app())
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/v1/documents/compare-files",
                    files={
                        "base_file": ("empty.pdf", b"fake-pdf", "application/pdf"),
                        "comparison_file": ("comp.pdf", b"fake-pdf", "application/pdf"),
                    },
                )

        assert response.status_code == 422
        assert "No text could be extracted" in response.json()["message"]

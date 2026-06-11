"""Tests for the folder-scoped search filter (#662).

Covers:
- normalize_folder_path: trimming, slash stripping, non-string input
- QueryRequest.folder_path: normalization + max-length validation
- FolderPathUpdate / FolderPathUpdateRequest validation
- _insert_processing_row: folder_path written on insert and conflict-update
- PATCH /documents/folder-paths handler: org scoping, dedupe, count parsing

Note: tests importing app.routers.documents require python-multipart and
are skipped if the dependency is unavailable (mirrors test_background_ingest).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import ValidationError

from app.models import FolderPathUpdate, FolderPathUpdateRequest, QueryRequest
from app.utils.folder_path import MAX_FOLDER_PATH_LENGTH, normalize_folder_path

TEST_ORG = "test-org"


def _can_import_router():
    try:
        from app.routers.documents import _insert_processing_row  # noqa: F401

        return True
    except (RuntimeError, ImportError):
        return False


_requires_multipart = pytest.mark.skipif(
    not _can_import_router(),
    reason="python-multipart required for router import",
)


def _async_ctx(mock_conn):
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return ctx


class TestNormalizeFolderPath:
    def test_plain_path_unchanged(self):
        assert normalize_folder_path("contracts/2024") == "contracts/2024"

    def test_strips_surrounding_slashes_and_whitespace(self):
        assert normalize_folder_path(" /contracts/2024/ ") == "contracts/2024"
        assert normalize_folder_path("/ / a") == "a"

    def test_empty_and_separator_only_become_none(self):
        assert normalize_folder_path("") is None
        assert normalize_folder_path("   ") is None
        assert normalize_folder_path("///") is None

    def test_non_string_becomes_none(self):
        assert normalize_folder_path(None) is None
        assert normalize_folder_path(42) is None
        assert normalize_folder_path(["a"]) is None

    def test_inner_slashes_preserved(self):
        assert normalize_folder_path("a/b/c") == "a/b/c"


class TestQueryRequestFolderPath:
    def test_defaults_to_none(self):
        req = QueryRequest(query="q", file_ids=["f1"])
        assert req.folder_path is None

    def test_normalizes_on_validation(self):
        req = QueryRequest(query="q", file_ids=["f1"], folder_path="/data-room/")
        assert req.folder_path == "data-room"

    def test_blank_folder_path_becomes_none(self):
        req = QueryRequest(query="q", file_ids=["f1"], folder_path="  / ")
        assert req.folder_path is None

    def test_over_long_folder_path_rejected(self):
        with pytest.raises(ValidationError):
            QueryRequest(query="q", file_ids=["f1"], folder_path="x" * (MAX_FOLDER_PATH_LENGTH + 1))

    def test_non_string_folder_path_rejected(self):
        with pytest.raises(ValidationError):
            QueryRequest(query="q", file_ids=["f1"], folder_path=123)


class TestFolderPathUpdateModels:
    def test_update_normalizes_folder_path(self):
        update = FolderPathUpdate(file_id="f1", folder_path="/a/b/")
        assert update.folder_path == "a/b"

    def test_update_accepts_null_folder_path(self):
        update = FolderPathUpdate(file_id="f1", folder_path=None)
        assert update.folder_path is None

    def test_request_rejects_empty_updates(self):
        with pytest.raises(ValidationError):
            FolderPathUpdateRequest(updates=[])

    def test_request_rejects_over_batch_limit(self):
        updates = [{"file_id": f"f{i}", "folder_path": "a"} for i in range(201)]
        with pytest.raises(ValidationError):
            FolderPathUpdateRequest(updates=updates)


@_requires_multipart
class TestInsertProcessingRow:
    @pytest.mark.asyncio
    async def test_writes_folder_path(self):
        from app.routers.documents import _insert_processing_row

        conn = AsyncMock()
        with (
            patch("app.routers.documents.get_pool", new_callable=AsyncMock, return_value=MagicMock()),
            patch("app.routers.documents.acquire_with_retry", return_value=_async_ctx(conn)),
        ):
            await _insert_processing_row(TEST_ORG, "file-1", "a.pdf", "contracts/2024")

        sql = conn.execute.call_args[0][0]
        assert "folder_path" in sql
        # Conflict-update keeps folder_path fresh on re-uploads.
        assert "folder_path = EXCLUDED.folder_path" in sql
        assert conn.execute.call_args[0][4] == "contracts/2024"

    @pytest.mark.asyncio
    async def test_defaults_to_null_folder_path(self):
        from app.routers.documents import _insert_processing_row

        conn = AsyncMock()
        with (
            patch("app.routers.documents.get_pool", new_callable=AsyncMock, return_value=MagicMock()),
            patch("app.routers.documents.acquire_with_retry", return_value=_async_ctx(conn)),
        ):
            await _insert_processing_row(TEST_ORG, "file-1", "a.pdf")

        assert conn.execute.call_args[0][4] is None


@_requires_multipart
class TestUpdateFolderPathsEndpoint:
    @pytest.mark.asyncio
    async def test_updates_scoped_to_org(self):
        from app.routers.documents import update_folder_paths

        conn = AsyncMock()
        conn.execute = AsyncMock(return_value="UPDATE 2")
        request = FolderPathUpdateRequest(
            updates=[
                {"file_id": "f1", "folder_path": "a/b"},
                {"file_id": "f2", "folder_path": None},
            ]
        )

        with (
            patch("app.routers.documents.get_pool", new_callable=AsyncMock, return_value=MagicMock()),
            patch("app.routers.documents.acquire_with_retry", return_value=_async_ctx(conn)),
        ):
            response = await update_folder_paths(request, org_slug=TEST_ORG)

        assert response.success is True
        assert response.updated_count == 2
        sql = conn.execute.call_args[0][0]
        assert "org_slug = $1" in sql
        assert conn.execute.call_args[0][1] == TEST_ORG
        assert conn.execute.call_args[0][2] == ["f1", "f2"]
        assert conn.execute.call_args[0][3] == ["a/b", None]

    @pytest.mark.asyncio
    async def test_duplicate_file_ids_last_wins(self):
        from app.routers.documents import update_folder_paths

        conn = AsyncMock()
        conn.execute = AsyncMock(return_value="UPDATE 1")
        request = FolderPathUpdateRequest(
            updates=[
                {"file_id": "f1", "folder_path": "old"},
                {"file_id": "f1", "folder_path": "new"},
            ]
        )

        with (
            patch("app.routers.documents.get_pool", new_callable=AsyncMock, return_value=MagicMock()),
            patch("app.routers.documents.acquire_with_retry", return_value=_async_ctx(conn)),
        ):
            response = await update_folder_paths(request, org_slug=TEST_ORG)

        assert response.updated_count == 1
        assert conn.execute.call_args[0][2] == ["f1"]
        assert conn.execute.call_args[0][3] == ["new"]

    @pytest.mark.asyncio
    async def test_db_error_returns_500(self):
        from fastapi import HTTPException

        from app.routers.documents import update_folder_paths

        conn = AsyncMock()
        conn.execute = AsyncMock(side_effect=RuntimeError("db down"))
        request = FolderPathUpdateRequest(updates=[{"file_id": "f1", "folder_path": "a"}])

        with (
            patch("app.routers.documents.get_pool", new_callable=AsyncMock, return_value=MagicMock()),
            patch("app.routers.documents.acquire_with_retry", return_value=_async_ctx(conn)),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await update_folder_paths(request, org_slug=TEST_ORG)

        assert exc_info.value.status_code == 500

"""Tests for document metadata pre-filtering (#1517).

Covers:
- sanitize_document_metadata: reserved keys, shape limits, lenient drops
- validate_metadata_object: strict rejection for filter/PATCH surfaces
- SearchFilters / QueryRequest.filters validation + effective accessors
- DocumentMetadataUpdate / DocumentMetadataUpdateRequest validation
- _insert_processing_row: metadata written on insert and conflict-update
- PATCH /documents/metadata handler: org scoping, dedupe, count parsing

Note: tests importing app.routers.documents require python-multipart and
are skipped if the dependency is unavailable (mirrors test_folder_path).
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import ValidationError

from app.models import (
    DocumentMetadataUpdate,
    DocumentMetadataUpdateRequest,
    QueryRequest,
    SearchFilters,
)
from app.utils.document_metadata import (
    MAX_METADATA_KEYS,
    MAX_METADATA_STRING_LENGTH,
    sanitize_document_metadata,
    validate_metadata_object,
)

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


class TestSanitizeDocumentMetadata:
    def test_keeps_flat_scalars(self):
        parsed = {"department": "legal", "year": 2023, "active": True, "score": 1.5}
        assert sanitize_document_metadata(parsed) == parsed

    def test_strips_reserved_keys(self):
        parsed = {
            "source_created_at": 1700000000000,
            "source_modified_at": 1700000000000,
            "folder_path": "a/b",
            "content_type": "application/pdf",
            "department": "legal",
        }
        assert sanitize_document_metadata(parsed) == {"department": "legal"}

    def test_drops_non_scalar_values(self):
        parsed = {"nested": {"a": 1}, "items": [1, 2], "none": None, "ok": "x"}
        assert sanitize_document_metadata(parsed) == {"ok": "x"}

    def test_drops_over_long_strings_and_keys(self):
        parsed = {
            "long_value": "x" * (MAX_METADATA_STRING_LENGTH + 1),
            "k" * 65: "v",
            "ok": "y",
        }
        assert sanitize_document_metadata(parsed) == {"ok": "y"}

    def test_caps_key_count(self):
        parsed = {f"k{i}": i for i in range(MAX_METADATA_KEYS + 5)}
        assert len(sanitize_document_metadata(parsed)) == MAX_METADATA_KEYS

    def test_empty_input_returns_empty(self):
        assert sanitize_document_metadata({}) == {}


class TestValidateMetadataObject:
    def test_accepts_scalars(self):
        value = {"department": "legal", "year": 2023}
        assert validate_metadata_object(value, allow_lists=False) == value

    def test_accepts_lists_when_allowed(self):
        value = {"year": [2023, 2024]}
        assert validate_metadata_object(value, allow_lists=True) == value

    def test_rejects_lists_when_not_allowed(self):
        with pytest.raises(ValueError, match="must be a scalar"):
            validate_metadata_object({"year": [2023]}, allow_lists=False)

    def test_rejects_reserved_keys(self):
        with pytest.raises(ValueError, match="reserved"):
            validate_metadata_object({"folder_path": "a"}, allow_lists=True)

    def test_rejects_empty_list(self):
        with pytest.raises(ValueError, match="1-"):
            validate_metadata_object({"year": []}, allow_lists=True)

    def test_rejects_too_many_keys(self):
        value = {f"k{i}": i for i in range(MAX_METADATA_KEYS + 1)}
        with pytest.raises(ValueError, match="exceeds"):
            validate_metadata_object(value, allow_lists=True)

    def test_rejects_nested_objects(self):
        with pytest.raises(ValueError, match="string, number, or boolean"):
            validate_metadata_object({"nested": {"a": 1}}, allow_lists=True)


class TestSearchFilters:
    def test_defaults(self):
        filters = SearchFilters()
        assert filters.folder_path is None
        assert filters.metadata is None

    def test_normalizes_folder_path(self):
        filters = SearchFilters(folder_path="/contracts/2024/")
        assert filters.folder_path == "contracts/2024"

    def test_accepts_equality_and_in_filters(self):
        filters = SearchFilters(metadata={"department": "legal", "year": [2023, 2024]})
        assert filters.metadata == {"department": "legal", "year": [2023, 2024]}

    def test_rejects_reserved_metadata_key(self):
        with pytest.raises(ValidationError):
            SearchFilters(metadata={"folder_path": "a"})

    def test_rejects_nested_metadata(self):
        with pytest.raises(ValidationError):
            SearchFilters(metadata={"nested": {"a": 1}})


class TestQueryRequestFilters:
    def test_filters_default_to_none(self):
        req = QueryRequest(query="q", file_ids=["f1"])
        assert req.filters is None
        assert req.effective_folder_path is None
        assert req.metadata_filters is None

    def test_filters_folder_path_wins_over_flat_field(self):
        req = QueryRequest(
            query="q",
            file_ids=["f1"],
            folder_path="legacy",
            filters={"folder_path": "structured"},
        )
        assert req.effective_folder_path == "structured"

    def test_flat_folder_path_still_supported(self):
        req = QueryRequest(query="q", file_ids=["f1"], folder_path="legacy")
        assert req.effective_folder_path == "legacy"

    def test_explicit_empty_filters_folder_path_overrides_legacy(self):
        # An explicitly provided `filters.folder_path` supersedes the legacy
        # field even when it normalizes to None ("no folder prefix" override),
        # rather than silently falling back to the legacy value.
        req = QueryRequest(
            query="q",
            file_ids=["f1"],
            folder_path="legacy",
            filters={"folder_path": ""},
        )
        assert req.effective_folder_path is None

    def test_filters_without_folder_path_falls_back_to_legacy(self):
        # `filters` set but `folder_path` absent → legacy field still wins.
        req = QueryRequest(
            query="q",
            file_ids=["f1"],
            folder_path="legacy",
            filters={"metadata": {"department": "legal"}},
        )
        assert req.effective_folder_path == "legacy"

    def test_metadata_filters_exposed(self):
        req = QueryRequest(
            query="q",
            file_ids=["f1"],
            filters={"metadata": {"department": "legal"}},
        )
        assert req.metadata_filters == {"department": "legal"}


class TestDocumentMetadataUpdateModels:
    def test_update_accepts_scalar_map(self):
        update = DocumentMetadataUpdate(file_id="f1", metadata={"team_id": "t1", "year": 2024})
        assert update.metadata == {"team_id": "t1", "year": 2024}

    def test_update_accepts_empty_map_to_clear(self):
        update = DocumentMetadataUpdate(file_id="f1", metadata={})
        assert update.metadata == {}

    def test_update_rejects_list_values(self):
        with pytest.raises(ValidationError):
            DocumentMetadataUpdate(file_id="f1", metadata={"year": [2024]})

    def test_update_rejects_reserved_keys(self):
        with pytest.raises(ValidationError):
            DocumentMetadataUpdate(file_id="f1", metadata={"content_type": "x"})

    def test_request_rejects_empty_updates(self):
        with pytest.raises(ValidationError):
            DocumentMetadataUpdateRequest(updates=[])

    def test_request_rejects_over_batch_limit(self):
        updates = [{"file_id": f"f{i}", "metadata": {"a": 1}} for i in range(201)]
        with pytest.raises(ValidationError):
            DocumentMetadataUpdateRequest(updates=updates)


@_requires_multipart
class TestInsertProcessingRowMetadata:
    @pytest.mark.asyncio
    async def test_writes_metadata(self):
        from app.routers.documents import _insert_processing_row

        conn = AsyncMock()
        with (
            patch("app.routers.documents.get_pool", new_callable=AsyncMock, return_value=MagicMock()),
            patch("app.routers.documents.acquire_with_retry", return_value=_async_ctx(conn)),
        ):
            await _insert_processing_row(TEST_ORG, "file-1", "a.pdf", None, {"department": "legal"})

        sql = conn.execute.call_args[0][0]
        # Conflict-update keeps metadata fresh on re-uploads.
        assert "metadata = EXCLUDED.metadata" in sql
        assert json.loads(conn.execute.call_args[0][5]) == {"department": "legal"}

    @pytest.mark.asyncio
    async def test_defaults_to_empty_object(self):
        from app.routers.documents import _insert_processing_row

        conn = AsyncMock()
        with (
            patch("app.routers.documents.get_pool", new_callable=AsyncMock, return_value=MagicMock()),
            patch("app.routers.documents.acquire_with_retry", return_value=_async_ctx(conn)),
        ):
            await _insert_processing_row(TEST_ORG, "file-1", "a.pdf")

        assert conn.execute.call_args[0][5] == "{}"


@_requires_multipart
class TestUpdateDocumentMetadataEndpoint:
    @pytest.mark.asyncio
    async def test_updates_scoped_to_org(self):
        from app.routers.documents import update_document_metadata

        conn = AsyncMock()
        conn.execute = AsyncMock(return_value="UPDATE 2")
        request = DocumentMetadataUpdateRequest(
            updates=[
                {"file_id": "f1", "metadata": {"team_id": "t1"}},
                {"file_id": "f2", "metadata": {}},
            ]
        )

        with (
            patch("app.routers.documents.get_pool", new_callable=AsyncMock, return_value=MagicMock()),
            patch("app.routers.documents.acquire_with_retry", return_value=_async_ctx(conn)),
        ):
            response = await update_document_metadata(request, org_slug=TEST_ORG)

        assert response.success is True
        assert response.updated_count == 2
        sql = conn.execute.call_args[0][0]
        assert "org_slug = $1" in sql
        assert conn.execute.call_args[0][1] == TEST_ORG
        assert conn.execute.call_args[0][2] == ["f1", "f2"]
        assert conn.execute.call_args[0][3] == ['{"team_id": "t1"}', "{}"]

    @pytest.mark.asyncio
    async def test_duplicate_file_ids_last_wins(self):
        from app.routers.documents import update_document_metadata

        conn = AsyncMock()
        conn.execute = AsyncMock(return_value="UPDATE 1")
        request = DocumentMetadataUpdateRequest(
            updates=[
                {"file_id": "f1", "metadata": {"v": "old"}},
                {"file_id": "f1", "metadata": {"v": "new"}},
            ]
        )

        with (
            patch("app.routers.documents.get_pool", new_callable=AsyncMock, return_value=MagicMock()),
            patch("app.routers.documents.acquire_with_retry", return_value=_async_ctx(conn)),
        ):
            response = await update_document_metadata(request, org_slug=TEST_ORG)

        assert response.updated_count == 1
        assert conn.execute.call_args[0][2] == ["f1"]
        assert conn.execute.call_args[0][3] == ['{"v": "new"}']

    @pytest.mark.asyncio
    async def test_db_error_returns_500(self):
        from fastapi import HTTPException

        from app.routers.documents import update_document_metadata

        conn = AsyncMock()
        conn.execute = AsyncMock(side_effect=RuntimeError("db down"))
        request = DocumentMetadataUpdateRequest(updates=[{"file_id": "f1", "metadata": {"a": 1}}])

        with (
            patch("app.routers.documents.get_pool", new_callable=AsyncMock, return_value=MagicMock()),
            patch("app.routers.documents.acquire_with_retry", return_value=_async_ctx(conn)),
            pytest.raises(HTTPException) as exc_info,
        ):
            await update_document_metadata(request, org_slug=TEST_ORG)

        assert exc_info.value.status_code == 500

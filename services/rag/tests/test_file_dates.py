"""Tests for document date extraction helpers.

Covers:
- _parse_pdf_date: PDF date format parsing to datetime
- _ensure_aware: naive/aware datetime handling
- _extract_file_dates: dispatching by file extension
- _ms_timestamp_to_datetime: Unix ms timestamp conversion
- PreparedDocument date fields in index_document pipeline
"""

from __future__ import annotations

import datetime as dt
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.indexing_service import (
    _ensure_aware,
    _extract_file_dates,
    _parse_pdf_date,
)

pytestmark = pytest.mark.asyncio


class TestParsePdfDate:
    """PDF date format ``D:YYYYMMDDHHmmSSOHH'mm'`` parsing."""

    def test_full_date_with_timezone(self):
        result = _parse_pdf_date("D:20230615143052+02'00'")
        assert result is not None
        assert result.year == 2023
        assert result.month == 6
        assert result.day == 15
        assert result.hour == 14
        assert result.minute == 30
        assert result.second == 52
        assert result.tzinfo is not None

    def test_date_without_prefix(self):
        result = _parse_pdf_date("20230101120000Z")
        assert result is not None
        assert result.year == 2023
        assert result.tzinfo == dt.timezone.utc

    def test_date_only_year(self):
        result = _parse_pdf_date("D:2023")
        assert result is not None
        assert result.year == 2023
        assert result.month == 1
        assert result.day == 1

    def test_negative_timezone(self):
        result = _parse_pdf_date("D:20230615143052-05'00'")
        assert result is not None
        expected_offset = dt.timezone(dt.timedelta(hours=-5))
        assert result.utcoffset() == expected_offset.utcoffset(None)

    def test_none_input(self):
        assert _parse_pdf_date(None) is None

    def test_empty_string(self):
        assert _parse_pdf_date("") is None

    def test_non_string_input(self):
        assert _parse_pdf_date(12345) is None  # type: ignore[arg-type]

    def test_malformed_string(self):
        assert _parse_pdf_date("not-a-date") is None

    def test_year_below_min(self):
        assert _parse_pdf_date("D:1900") is None

    def test_year_above_max(self):
        assert _parse_pdf_date("D:2200") is None

    def test_whitespace_stripped(self):
        result = _parse_pdf_date("  D:20230101  ")
        assert result is not None
        assert result.year == 2023


class TestEnsureAware:
    """Timezone-aware datetime conversion."""

    def test_none_returns_none(self):
        assert _ensure_aware(None) is None

    def test_naive_gets_utc(self):
        naive = dt.datetime(2023, 1, 1, 12, 0, 0)
        result = _ensure_aware(naive)
        assert result is not None
        assert result.tzinfo == dt.timezone.utc

    def test_aware_preserved(self):
        tz = dt.timezone(dt.timedelta(hours=5))
        aware = dt.datetime(2023, 1, 1, 12, 0, 0, tzinfo=tz)
        result = _ensure_aware(aware)
        assert result is not None
        assert result.tzinfo == tz

    def test_non_datetime_returns_none(self):
        assert _ensure_aware("not a datetime") is None  # type: ignore[arg-type]


class TestExtractFileDates:
    """File date extraction by extension."""

    def test_unsupported_extension_returns_none_pair(self):
        created, modified = _extract_file_dates(b"data", "file.txt")
        assert created is None
        assert modified is None

    def test_no_extension_returns_none_pair(self):
        created, modified = _extract_file_dates(b"data", "noext")
        assert created is None
        assert modified is None

    def test_pdf_extraction_calls_fitz(self):
        mock_doc = MagicMock()
        mock_doc.metadata = {
            "creationDate": "D:20230615143052Z",
            "modDate": "D:20240101000000Z",
        }

        mock_fitz = MagicMock()
        mock_fitz.open.return_value = mock_doc

        with patch.dict(sys.modules, {"fitz": mock_fitz}):
            created, modified = _extract_file_dates(b"pdf-bytes", "report.pdf")

        assert created is not None
        assert created.year == 2023
        assert modified is not None
        assert modified.year == 2024
        mock_doc.close.assert_called_once()

    def test_pdf_extraction_handles_exception(self):
        mock_fitz = MagicMock()
        mock_fitz.open.side_effect = RuntimeError("corrupt")

        with patch.dict(sys.modules, {"fitz": mock_fitz}):
            created, modified = _extract_file_dates(b"bad-pdf", "broken.pdf")

        assert created is None
        assert modified is None

    def test_docx_extraction(self):
        mock_props = MagicMock()
        mock_props.created = dt.datetime(2023, 6, 15, 14, 30, 52)
        mock_props.modified = dt.datetime(2024, 1, 1, 0, 0, 0, tzinfo=dt.timezone.utc)

        mock_doc_instance = MagicMock()
        mock_doc_instance.core_properties = mock_props

        mock_docx = MagicMock()
        mock_docx.Document.return_value = mock_doc_instance

        with patch.dict(sys.modules, {"docx": mock_docx}):
            created, modified = _extract_file_dates(b"docx-bytes", "report.docx")

        assert created is not None
        assert created.tzinfo == dt.timezone.utc
        assert modified is not None

    def test_pptx_extraction(self):
        mock_props = MagicMock()
        mock_props.created = dt.datetime(2023, 3, 10, 9, 0, 0)
        mock_props.modified = None

        mock_prs_instance = MagicMock()
        mock_prs_instance.core_properties = mock_props

        mock_pptx = MagicMock()
        mock_pptx.Presentation.return_value = mock_prs_instance

        with patch.dict(sys.modules, {"pptx": mock_pptx}):
            created, modified = _extract_file_dates(b"pptx-bytes", "slides.pptx")

        assert created is not None
        assert modified is None


class TestMsTimestampToDatetime:
    """Unix millisecond timestamp conversion in the router."""

    def _import(self):
        from app.routers.documents import _ms_timestamp_to_datetime

        return _ms_timestamp_to_datetime

    def test_valid_timestamp(self):
        fn = self._import()
        result = fn(1687000000000)
        assert result is not None
        assert result.tzinfo == dt.timezone.utc
        assert result.year == 2023

    def test_none_returns_none(self):
        fn = self._import()
        assert fn(None) is None

    def test_string_timestamp(self):
        fn = self._import()
        result = fn("1687000000000")
        assert result is not None
        assert result.year == 2023

    def test_invalid_value_returns_none(self):
        fn = self._import()
        assert fn("not-a-number") is None

    def test_float_overflow_returns_none(self):
        fn = self._import()
        assert fn(10**30) is None


class TestIndexDocumentDatesThreaded:
    """Verify dates flow through index_document into PreparedDocument."""

    @pytest.fixture(autouse=True)
    def _no_cross_scope_clone(self):
        with patch(
            "app.services.indexing_service.find_existing_by_hash",
            new_callable=AsyncMock,
            return_value=None,
        ):
            yield

    async def test_file_extracted_dates_in_prepared_document(self):
        from app.services.indexing_service import prepare_document

        mock_embed = AsyncMock()
        mock_embed.embed_texts = AsyncMock(return_value=[[0.1, 0.2]])

        created = dt.datetime(2023, 6, 15, tzinfo=dt.timezone.utc)
        modified = dt.datetime(2024, 1, 1, tzinfo=dt.timezone.utc)

        with (
            patch(
                "app.services.indexing_service.extract_text",
                new_callable=AsyncMock,
                return_value=("Some text", False),
            ),
            patch(
                "app.services.indexing_service._extract_file_dates",
                return_value=(created, modified),
            ),
            patch(
                "app.services.indexing_service.chunk_content",
                return_value=[MagicMock(content="chunk", index=0)],
            ),
        ):
            result = await prepare_document(
                b"content",
                "test.pdf",
                embedding_service=mock_embed,
            )

        assert result is not None
        assert result.source_created_at == created
        assert result.source_modified_at == modified

    async def test_caller_dates_override_file_dates(self):
        from app.services.indexing_service import index_document

        mock_embed = AsyncMock()
        mock_embed.embed_texts = AsyncMock(return_value=[[0.1, 0.2]])

        file_created = dt.datetime(2023, 1, 1, tzinfo=dt.timezone.utc)
        caller_created = dt.datetime(2022, 6, 1, tzinfo=dt.timezone.utc)

        mock_conn = AsyncMock()
        mock_conn.fetchrow = AsyncMock(side_effect=[None, {"id": "uuid-1"}])
        mock_conn.executemany = AsyncMock()
        mock_tx = AsyncMock()
        mock_tx.__aenter__ = AsyncMock(return_value=mock_tx)
        mock_tx.__aexit__ = AsyncMock(return_value=False)
        mock_conn.transaction = MagicMock(return_value=mock_tx)

        ctx = AsyncMock()
        ctx.__aenter__ = AsyncMock(return_value=mock_conn)
        ctx.__aexit__ = AsyncMock(return_value=False)

        pool = MagicMock()

        with (
            patch("app.services.indexing_service.acquire_with_retry", return_value=ctx),
            patch("app.services.indexing_service.compute_content_hash", return_value="hash123"),
            patch(
                "app.services.indexing_service.extract_text",
                new_callable=AsyncMock,
                return_value=("Text", False),
            ),
            patch(
                "app.services.indexing_service._extract_file_dates",
                return_value=(file_created, None),
            ),
            patch(
                "app.services.indexing_service.chunk_content",
                return_value=[MagicMock(content="chunk", index=0)],
            ),
        ):
            result = await index_document(
                pool,
                "doc-1",
                b"content",
                "test.pdf",
                embedding_service=mock_embed,
                source_created_at=caller_created,
            )

        assert result["success"] is True

        # The INSERT query has 7 positional args:
        # $1=file_id, $2=filename, $3=content_hash, $4=user_id, $5=chunks_count,
        # $6=source_created_at, $7=source_modified_at
        insert_call = mock_conn.fetchrow.call_args_list[1]
        args = insert_call[0]
        # args[0] is the SQL string, positional params start at args[1]
        source_created_arg = args[6]  # $6
        assert source_created_arg == caller_created

"""Tests for document indexing service.

Covers:
- Successful indexing pipeline (extract -> chunk -> embed -> store)
- Content hash dedup (skip when unchanged, re-ingest when changed)
- Empty content handling (no text extracted, no chunks produced)
- UnicodeDecodeError wrapping
- Transaction semantics (document + chunks inserted together)
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


@dataclass
class ContentChunk:
    """Local stub matching tale_knowledge.chunking.ContentChunk interface."""

    content: str
    index: int


def _mock_pool(
    *,
    existing_row: dict[str, Any] | None = None,
    inserted_doc_id: str = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
):
    """Build a mock asyncpg pool that returns a mock connection via acquire_with_retry.

    The mock connection tracks calls to fetchrow, fetchval, execute, and supports
    the transaction context manager pattern.
    """
    mock_conn = AsyncMock()
    mock_conn.fetchrow = AsyncMock(
        side_effect=[
            existing_row,
            {"id": inserted_doc_id},
        ]
    )
    mock_conn.execute = AsyncMock()

    mock_tx = AsyncMock()
    mock_tx.__aenter__ = AsyncMock(return_value=mock_tx)
    mock_tx.__aexit__ = AsyncMock(return_value=False)
    mock_conn.transaction = MagicMock(return_value=mock_tx)

    pool = MagicMock()
    return pool, mock_conn


def _patch_acquire(mock_conn):
    """Return a patch for acquire_with_retry that yields mock_conn."""
    return patch(
        "app.services.indexing_service.acquire_with_retry",
        return_value=_async_ctx(mock_conn),
    )


def _async_ctx(mock_conn):
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return ctx


SAMPLE_CONTENT = b"Hello, this is a sample document with enough text to chunk."
SAMPLE_FILENAME = "test.txt"
SAMPLE_DOC_ID = "doc-123"
SAMPLE_TEAM_ID = "team-abc"
SAMPLE_USER_ID = "user-xyz"
SAMPLE_HASH = "abcdef1234567890"
DIFFERENT_HASH = "ffffffffffffffff"

SAMPLE_CHUNKS = [
    ContentChunk(content="chunk zero content", index=0),
    ContentChunk(content="chunk one content", index=1),
]

SAMPLE_EMBEDDINGS = [
    [0.1, 0.2, 0.3],
    [0.4, 0.5, 0.6],
]


class TestSuccessfulIndexing:
    """Test the full indexing pipeline: extract -> chunk -> embed -> store."""

    async def test_indexes_new_document(self):
        from app.services.indexing_service import index_document

        pool, mock_conn = _mock_pool(existing_row=None)
        mock_embed = AsyncMock()
        mock_embed.embed_texts = AsyncMock(return_value=SAMPLE_EMBEDDINGS)

        with (
            _patch_acquire(mock_conn),
            patch("app.services.indexing_service.compute_content_hash", return_value=SAMPLE_HASH),
            patch("app.services.indexing_service.extract_text", return_value=("Extracted document text here.", False)),
            patch("app.services.indexing_service.chunk_content", return_value=SAMPLE_CHUNKS),
        ):
            result = await index_document(
                pool,
                SAMPLE_DOC_ID,
                SAMPLE_CONTENT,
                SAMPLE_FILENAME,
                team_id=SAMPLE_TEAM_ID,
                user_id=SAMPLE_USER_ID,
                embedding_service=mock_embed,
            )

        assert result["success"] is True
        assert result["document_id"] == SAMPLE_DOC_ID
        assert result["chunks_created"] == 2
        assert result["skipped"] is False
        assert result["skip_reason"] is None

    async def test_embed_texts_called_with_chunk_contents(self):
        from app.services.indexing_service import index_document

        pool, mock_conn = _mock_pool(existing_row=None)
        mock_embed = AsyncMock()
        mock_embed.embed_texts = AsyncMock(return_value=SAMPLE_EMBEDDINGS)

        with (
            _patch_acquire(mock_conn),
            patch("app.services.indexing_service.compute_content_hash", return_value=SAMPLE_HASH),
            patch("app.services.indexing_service.extract_text", return_value=("Some text", False)),
            patch("app.services.indexing_service.chunk_content", return_value=SAMPLE_CHUNKS),
        ):
            await index_document(
                pool,
                SAMPLE_DOC_ID,
                SAMPLE_CONTENT,
                SAMPLE_FILENAME,
                embedding_service=mock_embed,
            )

        mock_embed.embed_texts.assert_awaited_once_with(["chunk zero content", "chunk one content"])

    async def test_chunk_insert_called_per_chunk(self):
        from app.services.indexing_service import index_document

        pool, mock_conn = _mock_pool(existing_row=None)
        mock_embed = AsyncMock()
        mock_embed.embed_texts = AsyncMock(return_value=SAMPLE_EMBEDDINGS)

        with (
            _patch_acquire(mock_conn),
            patch("app.services.indexing_service.compute_content_hash", return_value=SAMPLE_HASH),
            patch("app.services.indexing_service.extract_text", return_value=("Some text", False)),
            patch("app.services.indexing_service.chunk_content", return_value=SAMPLE_CHUNKS),
        ):
            await index_document(
                pool,
                SAMPLE_DOC_ID,
                SAMPLE_CONTENT,
                SAMPLE_FILENAME,
                team_id=SAMPLE_TEAM_ID,
                embedding_service=mock_embed,
            )

        # 1 fetchrow (dedup check) + 1 fetchrow (INSERT doc RETURNING id) + 2 chunk inserts
        # The execute calls are for the chunk INSERTs
        execute_calls = mock_conn.execute.call_args_list
        assert len(execute_calls) == 2

    async def test_passes_vision_client_to_extract(self):
        from app.services.indexing_service import index_document

        pool, mock_conn = _mock_pool(existing_row=None)
        mock_embed = AsyncMock()
        mock_embed.embed_texts = AsyncMock(return_value=SAMPLE_EMBEDDINGS)
        mock_vision = MagicMock()

        with (
            _patch_acquire(mock_conn),
            patch("app.services.indexing_service.compute_content_hash", return_value=SAMPLE_HASH),
            patch("app.services.indexing_service.extract_text", return_value=("vision text", True)) as mock_extract,
            patch("app.services.indexing_service.chunk_content", return_value=SAMPLE_CHUNKS),
        ):
            await index_document(
                pool,
                SAMPLE_DOC_ID,
                SAMPLE_CONTENT,
                SAMPLE_FILENAME,
                embedding_service=mock_embed,
                vision_client=mock_vision,
            )

        mock_extract.assert_awaited_once_with(
            SAMPLE_CONTENT,
            SAMPLE_FILENAME,
            vision_client=mock_vision,
        )

    async def test_custom_chunk_size_and_overlap(self):
        from app.services.indexing_service import index_document

        pool, mock_conn = _mock_pool(existing_row=None)
        mock_embed = AsyncMock()
        mock_embed.embed_texts = AsyncMock(return_value=SAMPLE_EMBEDDINGS)

        with (
            _patch_acquire(mock_conn),
            patch("app.services.indexing_service.compute_content_hash", return_value=SAMPLE_HASH),
            patch("app.services.indexing_service.extract_text", return_value=("text", False)),
            patch("app.services.indexing_service.chunk_content", return_value=SAMPLE_CHUNKS) as mock_chunk,
        ):
            await index_document(
                pool,
                SAMPLE_DOC_ID,
                SAMPLE_CONTENT,
                SAMPLE_FILENAME,
                embedding_service=mock_embed,
                chunk_size=256,
                chunk_overlap=25,
            )

        mock_chunk.assert_called_once_with("text", chunk_size=256, chunk_overlap=25)


class TestContentHashDedup:
    """Content hash dedup: skip when unchanged, re-ingest when changed."""

    async def test_skips_unchanged_content(self):
        from app.services.indexing_service import index_document

        existing = {"id": "existing-uuid", "content_hash": SAMPLE_HASH}
        pool, mock_conn = _mock_pool(existing_row=existing)
        mock_embed = AsyncMock()

        with (
            _patch_acquire(mock_conn),
            patch("app.services.indexing_service.compute_content_hash", return_value=SAMPLE_HASH),
        ):
            result = await index_document(
                pool,
                SAMPLE_DOC_ID,
                SAMPLE_CONTENT,
                SAMPLE_FILENAME,
                team_id=SAMPLE_TEAM_ID,
                embedding_service=mock_embed,
            )

        assert result["skipped"] is True
        assert result["skip_reason"] == "content_unchanged"
        assert result["chunks_created"] == 0
        mock_embed.embed_texts.assert_not_awaited()

    async def test_reindexes_when_content_changed(self):
        from app.services.indexing_service import index_document

        existing = {"id": "existing-uuid", "content_hash": DIFFERENT_HASH}
        pool, mock_conn = _mock_pool(existing_row=existing)
        mock_embed = AsyncMock()
        mock_embed.embed_texts = AsyncMock(return_value=SAMPLE_EMBEDDINGS)

        # The connection is used multiple times:
        # 1. fetchrow for dedup check -> returns existing row
        # 2. execute for DELETE old doc
        # 3. fetchrow for INSERT new doc RETURNING id
        # 4. execute for each chunk INSERT
        mock_conn.fetchrow = AsyncMock(
            side_effect=[
                existing,
                {"id": "new-uuid"},
            ]
        )

        with (
            _patch_acquire(mock_conn),
            patch("app.services.indexing_service.compute_content_hash", return_value=SAMPLE_HASH),
            patch("app.services.indexing_service.extract_text", return_value=("Updated text", False)),
            patch("app.services.indexing_service.chunk_content", return_value=SAMPLE_CHUNKS),
        ):
            result = await index_document(
                pool,
                SAMPLE_DOC_ID,
                SAMPLE_CONTENT,
                SAMPLE_FILENAME,
                team_id=SAMPLE_TEAM_ID,
                embedding_service=mock_embed,
            )

        assert result["skipped"] is False
        assert result["chunks_created"] == 2

        # Should have executed a DELETE for the old document
        delete_calls = [c for c in mock_conn.execute.call_args_list if "DELETE" in str(c)]
        assert len(delete_calls) >= 1


class TestEmptyContentHandling:
    """Edge cases: no text extracted or no chunks produced."""

    async def test_no_text_extracted_returns_skipped(self):
        from app.services.indexing_service import index_document

        pool, mock_conn = _mock_pool(existing_row=None)
        mock_embed = AsyncMock()

        with (
            _patch_acquire(mock_conn),
            patch("app.services.indexing_service.compute_content_hash", return_value=SAMPLE_HASH),
            patch("app.services.indexing_service.extract_text", return_value=("", False)),
        ):
            result = await index_document(
                pool,
                SAMPLE_DOC_ID,
                SAMPLE_CONTENT,
                SAMPLE_FILENAME,
                embedding_service=mock_embed,
            )

        assert result["skipped"] is True
        assert result["skip_reason"] == "no_text_extracted"
        assert result["chunks_created"] == 0

    async def test_whitespace_only_text_returns_skipped(self):
        from app.services.indexing_service import index_document

        pool, mock_conn = _mock_pool(existing_row=None)
        mock_embed = AsyncMock()

        with (
            _patch_acquire(mock_conn),
            patch("app.services.indexing_service.compute_content_hash", return_value=SAMPLE_HASH),
            patch("app.services.indexing_service.extract_text", return_value=("   \n\t  ", False)),
        ):
            result = await index_document(
                pool,
                SAMPLE_DOC_ID,
                SAMPLE_CONTENT,
                SAMPLE_FILENAME,
                embedding_service=mock_embed,
            )

        assert result["skipped"] is True
        assert result["skip_reason"] == "no_text_extracted"

    async def test_no_chunks_produced_returns_skipped(self):
        from app.services.indexing_service import index_document

        pool, mock_conn = _mock_pool(existing_row=None)
        mock_embed = AsyncMock()

        with (
            _patch_acquire(mock_conn),
            patch("app.services.indexing_service.compute_content_hash", return_value=SAMPLE_HASH),
            patch("app.services.indexing_service.extract_text", return_value=("Some text", False)),
            patch("app.services.indexing_service.chunk_content", return_value=[]),
        ):
            result = await index_document(
                pool,
                SAMPLE_DOC_ID,
                SAMPLE_CONTENT,
                SAMPLE_FILENAME,
                embedding_service=mock_embed,
            )

        assert result["skipped"] is True
        assert result["skip_reason"] == "no_chunks_produced"

    async def test_none_text_extracted_returns_skipped(self):
        from app.services.indexing_service import index_document

        pool, mock_conn = _mock_pool(existing_row=None)
        mock_embed = AsyncMock()

        with (
            _patch_acquire(mock_conn),
            patch("app.services.indexing_service.compute_content_hash", return_value=SAMPLE_HASH),
            patch("app.services.indexing_service.extract_text", return_value=(None, False)),
        ):
            result = await index_document(
                pool,
                SAMPLE_DOC_ID,
                SAMPLE_CONTENT,
                SAMPLE_FILENAME,
                embedding_service=mock_embed,
            )

        assert result["skipped"] is True
        assert result["skip_reason"] == "no_text_extracted"


class TestExtractionErrors:
    """Extraction failure modes."""

    async def test_unicode_decode_error_raises_value_error(self):
        from app.services.indexing_service import index_document

        pool, mock_conn = _mock_pool(existing_row=None)
        mock_embed = AsyncMock()

        with (
            _patch_acquire(mock_conn),
            patch("app.services.indexing_service.compute_content_hash", return_value=SAMPLE_HASH),
            patch(
                "app.services.indexing_service.extract_text", side_effect=UnicodeDecodeError("utf-8", b"", 0, 1, "bad")
            ),
        ):
            with pytest.raises(ValueError, match="Could not decode file"):
                await index_document(
                    pool,
                    SAMPLE_DOC_ID,
                    SAMPLE_CONTENT,
                    "binary.xyz",
                    embedding_service=mock_embed,
                )

    async def test_unicode_error_message_includes_filename(self):
        from app.services.indexing_service import index_document

        pool, mock_conn = _mock_pool(existing_row=None)
        mock_embed = AsyncMock()

        with (
            _patch_acquire(mock_conn),
            patch("app.services.indexing_service.compute_content_hash", return_value=SAMPLE_HASH),
            patch(
                "app.services.indexing_service.extract_text", side_effect=UnicodeDecodeError("utf-8", b"", 0, 1, "bad")
            ),
        ):
            with pytest.raises(ValueError, match="my-file.bin"):
                await index_document(
                    pool,
                    SAMPLE_DOC_ID,
                    SAMPLE_CONTENT,
                    "my-file.bin",
                    embedding_service=mock_embed,
                )

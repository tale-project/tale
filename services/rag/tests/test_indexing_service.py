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
from unittest.mock import AsyncMock, MagicMock, call, patch

import asyncpg.exceptions
import pytest

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def _no_cross_scope_clone():
    """Disable cross-scope clone lookup by default so existing tests are unaffected."""
    with patch(
        "app.services.indexing_service.find_existing_by_hash",
        new_callable=AsyncMock,
        return_value=None,
    ):
        yield


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
            patch(
                "app.services.indexing_service.extract_text",
                new_callable=AsyncMock,
                return_value=("Extracted document text here.", False),
            ),
            patch("app.services.indexing_service.chunk_content", return_value=SAMPLE_CHUNKS),
        ):
            result = await index_document(
                pool,
                SAMPLE_DOC_ID,
                SAMPLE_CONTENT,
                SAMPLE_FILENAME,
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
            patch(
                "app.services.indexing_service.extract_text", new_callable=AsyncMock, return_value=("Some text", False)
            ),
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
            patch(
                "app.services.indexing_service.extract_text", new_callable=AsyncMock, return_value=("Some text", False)
            ),
            patch("app.services.indexing_service.chunk_content", return_value=SAMPLE_CHUNKS),
        ):
            await index_document(
                pool,
                SAMPLE_DOC_ID,
                SAMPLE_CONTENT,
                SAMPLE_FILENAME,
                embedding_service=mock_embed,
            )

        # Chunks inserted via executemany in a single batch call
        mock_conn.executemany.assert_awaited_once()
        chunk_rows = mock_conn.executemany.call_args[0][1]
        assert len(chunk_rows) == 2

    async def test_passes_vision_client_to_extract(self):
        from app.services.indexing_service import index_document

        pool, mock_conn = _mock_pool(existing_row=None)
        mock_embed = AsyncMock()
        mock_embed.embed_texts = AsyncMock(return_value=SAMPLE_EMBEDDINGS)
        mock_vision = MagicMock()

        with (
            _patch_acquire(mock_conn),
            patch("app.services.indexing_service.compute_content_hash", return_value=SAMPLE_HASH),
            patch(
                "app.services.indexing_service.extract_text", new_callable=AsyncMock, return_value=("vision text", True)
            ) as mock_extract,
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
            patch("app.services.indexing_service.extract_text", new_callable=AsyncMock, return_value=("text", False)),
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
        mock_embed.embed_texts = AsyncMock(return_value=SAMPLE_EMBEDDINGS)

        with (
            _patch_acquire(mock_conn),
            patch("app.services.indexing_service.compute_content_hash", return_value=SAMPLE_HASH),
            patch(
                "app.services.indexing_service.extract_text",
                new_callable=AsyncMock,
                return_value=("Some text", False),
            ),
            patch("app.services.indexing_service.chunk_content", return_value=SAMPLE_CHUNKS),
        ):
            result = await index_document(
                pool,
                SAMPLE_DOC_ID,
                SAMPLE_CONTENT,
                SAMPLE_FILENAME,
                embedding_service=mock_embed,
            )

        assert result["skipped"] is True
        assert result["skip_reason"] == "content_unchanged"
        assert result["chunks_created"] == 0

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
            patch(
                "app.services.indexing_service.extract_text",
                new_callable=AsyncMock,
                return_value=("Updated text", False),
            ),
            patch("app.services.indexing_service.chunk_content", return_value=SAMPLE_CHUNKS),
        ):
            result = await index_document(
                pool,
                SAMPLE_DOC_ID,
                SAMPLE_CONTENT,
                SAMPLE_FILENAME,
                embedding_service=mock_embed,
            )

        assert result["skipped"] is False
        assert result["chunks_created"] == 2

        # Should have executed a DELETE for the old document
        delete_calls = [c for c in mock_conn.execute.call_args_list if "DELETE" in str(c)]
        assert len(delete_calls) >= 1


class TestExplicitChunkDeletion:
    """Chunks must be deleted explicitly before documents to prevent BM25 index corruption."""

    async def test_replacement_deletes_chunks_before_document(self):
        from app.services.indexing_service import index_document

        existing = {"id": "existing-uuid", "content_hash": DIFFERENT_HASH}
        pool, mock_conn = _mock_pool(existing_row=existing)
        mock_embed = AsyncMock()
        mock_embed.embed_texts = AsyncMock(return_value=SAMPLE_EMBEDDINGS)

        mock_conn.fetchrow = AsyncMock(
            side_effect=[
                existing,
                {"id": "new-uuid"},
            ]
        )

        call_order: list[str] = []
        original_execute = mock_conn.execute

        async def track_execute(sql, *args, **kwargs):
            if "DELETE" in sql and "chunks" in sql:
                call_order.append("delete_chunks")
            elif "DELETE" in sql and "documents" in sql:
                call_order.append("delete_documents")
            return await original_execute(sql, *args, **kwargs)

        mock_conn.execute = AsyncMock(side_effect=track_execute)

        with (
            _patch_acquire(mock_conn),
            patch("app.services.indexing_service.compute_content_hash", return_value=SAMPLE_HASH),
            patch(
                "app.services.indexing_service.extract_text",
                new_callable=AsyncMock,
                return_value=("Updated text", False),
            ),
            patch("app.services.indexing_service.chunk_content", return_value=SAMPLE_CHUNKS),
        ):
            await index_document(
                pool,
                SAMPLE_DOC_ID,
                SAMPLE_CONTENT,
                SAMPLE_FILENAME,
                embedding_service=mock_embed,
            )

        assert call_order == ["delete_chunks", "delete_documents"]

    async def test_replacement_uses_transaction(self):
        from app.services.indexing_service import index_document

        existing = {"id": "existing-uuid", "content_hash": DIFFERENT_HASH}
        pool, mock_conn = _mock_pool(existing_row=existing)
        mock_embed = AsyncMock()
        mock_embed.embed_texts = AsyncMock(return_value=SAMPLE_EMBEDDINGS)

        mock_conn.fetchrow = AsyncMock(
            side_effect=[
                existing,
                {"id": "new-uuid"},
            ]
        )

        with (
            _patch_acquire(mock_conn),
            patch("app.services.indexing_service.compute_content_hash", return_value=SAMPLE_HASH),
            patch(
                "app.services.indexing_service.extract_text",
                new_callable=AsyncMock,
                return_value=("Updated text", False),
            ),
            patch("app.services.indexing_service.chunk_content", return_value=SAMPLE_CHUNKS),
        ):
            await index_document(
                pool,
                SAMPLE_DOC_ID,
                SAMPLE_CONTENT,
                SAMPLE_FILENAME,
                embedding_service=mock_embed,
            )

        # The deletion of old doc should use a transaction
        mock_conn.transaction.assert_called()


class TestEmptyContentHandling:
    """Edge cases: no text extracted or no chunks produced."""

    async def test_no_text_extracted_returns_skipped(self):
        from app.services.indexing_service import index_document

        pool, mock_conn = _mock_pool(existing_row=None)
        mock_embed = AsyncMock()

        with (
            _patch_acquire(mock_conn),
            patch("app.services.indexing_service.compute_content_hash", return_value=SAMPLE_HASH),
            patch("app.services.indexing_service.extract_text", new_callable=AsyncMock, return_value=("", False)),
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
            patch(
                "app.services.indexing_service.extract_text", new_callable=AsyncMock, return_value=("   \n\t  ", False)
            ),
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
            patch(
                "app.services.indexing_service.extract_text", new_callable=AsyncMock, return_value=("Some text", False)
            ),
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
        assert result["skip_reason"] == "no_text_extracted"

    async def test_none_text_extracted_returns_skipped(self):
        from app.services.indexing_service import index_document

        pool, mock_conn = _mock_pool(existing_row=None)
        mock_embed = AsyncMock()

        with (
            _patch_acquire(mock_conn),
            patch("app.services.indexing_service.compute_content_hash", return_value=SAMPLE_HASH),
            patch("app.services.indexing_service.extract_text", new_callable=AsyncMock, return_value=(None, False)),
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
                "app.services.indexing_service.extract_text",
                new_callable=AsyncMock,
                side_effect=UnicodeDecodeError("utf-8", b"", 0, 1, "bad"),
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
                "app.services.indexing_service.extract_text",
                new_callable=AsyncMock,
                side_effect=UnicodeDecodeError("utf-8", b"", 0, 1, "bad"),
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


class TestHnswIndexSelfHealing:
    """HNSW index corruption auto-recovery via REINDEX + retry."""

    async def test_reindexes_and_retries_on_hnsw_corruption(self):
        from app.services.indexing_service import store_prepared_document, PreparedDocument

        pool, mock_conn = _mock_pool(existing_row=None)
        # fetchrow: SELECT (dedup) → None, INSERT (attempt 1) → id, INSERT (attempt 2) → id
        mock_conn.fetchrow = AsyncMock(side_effect=[None, {"id": "uuid-1"}, {"id": "uuid-2"}])

        prepared = PreparedDocument(
            content_hash=SAMPLE_HASH,
            chunks=SAMPLE_CHUNKS,
            embeddings=SAMPLE_EMBEDDINGS,
            vision_used=False,
        )

        corruption_error = asyncpg.exceptions.InternalServerError(
            'page 0 of relation "chunks" should be empty but is not'
        )

        call_count = 0
        original_executemany = mock_conn.executemany

        async def fail_then_succeed(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise corruption_error
            return await original_executemany(*args, **kwargs)

        mock_conn.executemany = AsyncMock(side_effect=fail_then_succeed)

        with (
            _patch_acquire(mock_conn),
            patch("app.services.indexing_service.compute_content_hash", return_value=SAMPLE_HASH),
        ):
            result = await store_prepared_document(
                pool,
                SAMPLE_DOC_ID,
                SAMPLE_FILENAME,
                prepared,
                user_id=SAMPLE_USER_ID,
            )

        assert result["success"] is True
        assert result["chunks_created"] == 2
        assert call_count == 2
        reindex_calls = [c for c in mock_conn.execute.call_args_list if "REINDEX" in str(c)]
        assert len(reindex_calls) == 1

    async def test_raises_on_second_hnsw_corruption(self):
        from app.services.indexing_service import store_prepared_document, PreparedDocument

        pool, mock_conn = _mock_pool(existing_row=None)
        # fetchrow: SELECT (dedup) → None, INSERT (attempt 1) → id, INSERT (attempt 2) → id
        mock_conn.fetchrow = AsyncMock(side_effect=[None, {"id": "uuid-1"}, {"id": "uuid-2"}])

        prepared = PreparedDocument(
            content_hash=SAMPLE_HASH,
            chunks=SAMPLE_CHUNKS,
            embeddings=SAMPLE_EMBEDDINGS,
            vision_used=False,
        )

        corruption_error = asyncpg.exceptions.InternalServerError(
            'page 0 of relation "chunks" should be empty but is not'
        )
        mock_conn.executemany = AsyncMock(side_effect=corruption_error)

        with (
            _patch_acquire(mock_conn),
            patch("app.services.indexing_service.compute_content_hash", return_value=SAMPLE_HASH),
        ):
            with pytest.raises(asyncpg.exceptions.InternalServerError):
                await store_prepared_document(
                    pool,
                    SAMPLE_DOC_ID,
                    SAMPLE_FILENAME,
                    prepared,
                    user_id=SAMPLE_USER_ID,
                )

    async def test_non_hnsw_internal_error_not_retried(self):
        from app.services.indexing_service import store_prepared_document, PreparedDocument

        pool, mock_conn = _mock_pool(existing_row=None)

        prepared = PreparedDocument(
            content_hash=SAMPLE_HASH,
            chunks=SAMPLE_CHUNKS,
            embeddings=SAMPLE_EMBEDDINGS,
            vision_used=False,
        )

        other_error = asyncpg.exceptions.InternalServerError("some other internal error")
        mock_conn.executemany = AsyncMock(side_effect=other_error)

        with (
            _patch_acquire(mock_conn),
            patch("app.services.indexing_service.compute_content_hash", return_value=SAMPLE_HASH),
        ):
            with pytest.raises(asyncpg.exceptions.InternalServerError, match="some other internal error"):
                await store_prepared_document(
                    pool,
                    SAMPLE_DOC_ID,
                    SAMPLE_FILENAME,
                    prepared,
                    user_id=SAMPLE_USER_ID,
                )

        reindex_calls = [c for c in mock_conn.execute.call_args_list if "REINDEX" in str(c)]
        assert len(reindex_calls) == 0


class TestCrossHashClone:
    """Cross-scope content hash dedup: clone chunks from existing document."""

    @pytest.fixture(autouse=True)
    def _no_cross_scope_clone(self):
        """Override the module-level autouse fixture so clone functions are not patched."""
        yield

    async def test_find_existing_by_hash_returns_id_when_found(self):
        from app.services.indexing_service import find_existing_by_hash

        pool, mock_conn = _mock_pool()
        mock_conn.fetchrow = AsyncMock(return_value={"id": 42})

        with _patch_acquire(mock_conn):
            result = await find_existing_by_hash(pool, SAMPLE_HASH)

        assert result == 42

    async def test_find_existing_by_hash_returns_none_when_not_found(self):
        from app.services.indexing_service import find_existing_by_hash

        pool, mock_conn = _mock_pool()
        mock_conn.fetchrow = AsyncMock(return_value=None)

        with _patch_acquire(mock_conn):
            result = await find_existing_by_hash(pool, SAMPLE_HASH)

        assert result is None

    async def test_clone_skips_when_target_has_same_hash(self):
        from app.services.indexing_service import clone_from_existing

        pool, mock_conn = _mock_pool()
        mock_conn.fetchrow = AsyncMock(return_value={"id": "existing-target-uuid", "content_hash": SAMPLE_HASH})

        with _patch_acquire(mock_conn):
            result = await clone_from_existing(
                pool,
                42,
                SAMPLE_DOC_ID,
                SAMPLE_FILENAME,
                SAMPLE_HASH,
                user_id="user-new",
            )

        assert result["skipped"] is True
        assert result["skip_reason"] == "content_unchanged"

    async def test_clone_copies_chunks_from_source(self):
        from app.services.indexing_service import clone_from_existing

        pool, mock_conn = _mock_pool()
        # fetchrow calls: 1) dedup check → None, 2) source check → exists, 3) INSERT doc → id
        mock_conn.fetchrow = AsyncMock(
            side_effect=[
                None,
                {"chunks_count": 5},
                {"id": "new-uuid"},
            ]
        )
        mock_conn.fetchval = AsyncMock(return_value=5)

        with _patch_acquire(mock_conn):
            result = await clone_from_existing(
                pool,
                42,
                SAMPLE_DOC_ID,
                SAMPLE_FILENAME,
                SAMPLE_HASH,
                user_id="user-new",
            )

        assert result["success"] is True
        assert result["chunks_created"] == 5
        assert result["skipped"] is False

    async def test_clone_returns_none_when_source_vanished(self):
        from app.services.indexing_service import clone_from_existing

        pool, mock_conn = _mock_pool()
        # fetchrow calls: 1) dedup check → None, 2) source check → None (deleted)
        mock_conn.fetchrow = AsyncMock(side_effect=[None, None])

        with _patch_acquire(mock_conn):
            result = await clone_from_existing(
                pool,
                42,
                SAMPLE_DOC_ID,
                SAMPLE_FILENAME,
                SAMPLE_HASH,
                user_id="user-new",
            )

        assert result is None

    async def test_index_document_uses_clone_when_hash_exists(self):
        """index_document should clone instead of extracting when hash match found."""
        from app.services.indexing_service import index_document

        pool, mock_conn = _mock_pool(existing_row=None)
        mock_embed = AsyncMock()

        with (
            _patch_acquire(mock_conn),
            patch(
                "app.services.indexing_service.find_existing_by_hash",
                new_callable=AsyncMock,
                return_value=99,
            ),
            patch(
                "app.services.indexing_service.clone_from_existing",
                new_callable=AsyncMock,
                return_value={
                    "success": True,
                    "document_id": SAMPLE_DOC_ID,
                    "chunks_created": 3,
                    "skipped": False,
                    "skip_reason": None,
                },
            ) as mock_clone,
            patch("app.services.indexing_service.compute_content_hash", return_value=SAMPLE_HASH),
            patch("app.services.indexing_service.extract_text", new_callable=AsyncMock) as mock_extract,
        ):
            result = await index_document(
                pool,
                SAMPLE_DOC_ID,
                SAMPLE_CONTENT,
                SAMPLE_FILENAME,
                embedding_service=mock_embed,
            )

        assert result["chunks_created"] == 3
        mock_clone.assert_awaited_once()
        mock_extract.assert_not_awaited()

    async def test_index_document_falls_back_when_clone_returns_none(self):
        """If clone source vanishes, fall back to full processing."""
        from app.services.indexing_service import index_document

        pool, mock_conn = _mock_pool(existing_row=None)
        mock_embed = AsyncMock()
        mock_embed.embed_texts = AsyncMock(return_value=SAMPLE_EMBEDDINGS)

        with (
            _patch_acquire(mock_conn),
            patch(
                "app.services.indexing_service.find_existing_by_hash",
                new_callable=AsyncMock,
                return_value=99,
            ),
            patch(
                "app.services.indexing_service.clone_from_existing",
                new_callable=AsyncMock,
                return_value=None,
            ),
            patch("app.services.indexing_service.compute_content_hash", return_value=SAMPLE_HASH),
            patch(
                "app.services.indexing_service.extract_text",
                new_callable=AsyncMock,
                return_value=("Extracted text", False),
            ),
            patch("app.services.indexing_service.chunk_content", return_value=SAMPLE_CHUNKS),
        ):
            result = await index_document(
                pool,
                SAMPLE_DOC_ID,
                SAMPLE_CONTENT,
                SAMPLE_FILENAME,
                embedding_service=mock_embed,
            )

        assert result["success"] is True
        assert result["chunks_created"] == 2
        assert result["skipped"] is False

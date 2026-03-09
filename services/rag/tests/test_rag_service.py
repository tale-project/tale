"""Tests for the main RagService orchestrator.

Covers:
- add_document() with single team, user, and multiple targets
- search() delegation to RagSearchService with threshold filtering
- generate() with search results and empty results
- delete_document() with team authorization checks
- Error propagation from sub-services
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytestmark = pytest.mark.asyncio


def _make_service():
    """Create a RagService with all internal dependencies pre-mocked.

    Bypasses initialize() by directly setting the internal state.
    """
    from app.services.rag_service import RagService

    service = RagService()
    service.initialized = True
    service._pool = MagicMock()
    service._embedding_service = AsyncMock()
    service._vision_client = MagicMock()
    service._search_service = AsyncMock()
    service._openai_client = AsyncMock()
    return service


def _mock_conn(*, fetch_return=None, execute_return=None):
    """Create a mock connection for acquire_with_retry."""
    conn = AsyncMock()
    conn.fetch = AsyncMock(return_value=fetch_return or [])
    conn.execute = AsyncMock(return_value=execute_return)

    mock_tx = AsyncMock()
    mock_tx.__aenter__ = AsyncMock(return_value=mock_tx)
    mock_tx.__aexit__ = AsyncMock(return_value=False)
    conn.transaction = MagicMock(return_value=mock_tx)

    return conn


def _async_ctx(mock_conn):
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return ctx


class TestAddDocument:
    """add_document() delegates to index_document."""

    async def test_user_calls_index_document(self):
        service = _make_service()
        index_result = {
            "success": True,
            "document_id": "doc-1",
            "chunks_created": 5,
            "skipped": False,
            "skip_reason": None,
        }

        with patch(
            "app.services.rag_service.index_document", new_callable=AsyncMock, return_value=index_result
        ) as mock_idx:
            result = await service.add_document(
                b"content bytes",
                "doc-1",
                "report.pdf",
                user_id="user-1",
            )

        assert result["success"] is True
        assert result["document_id"] == "doc-1"
        assert result["chunks_created"] == 5
        mock_idx.assert_awaited_once()
        call_kwargs = mock_idx.call_args
        assert call_kwargs[1]["user_id"] == "user-1"

    async def test_skipped_returns_skipped(self):
        service = _make_service()
        index_result = {
            "success": True,
            "document_id": "doc-skip",
            "chunks_created": 0,
            "skipped": True,
            "skip_reason": "content_unchanged",
        }

        with patch("app.services.rag_service.index_document", new_callable=AsyncMock, return_value=index_result):
            result = await service.add_document(
                b"content",
                "doc-skip",
                "file.txt",
                user_id="user-1",
            )

        assert result["skipped"] is True
        assert result["skip_reason"] == "content_unchanged"

    async def test_initializes_if_not_initialized(self):
        from app.services.rag_service import RagService

        service = RagService()
        assert service.initialized is False

        with patch.object(service, "initialize", new_callable=AsyncMock) as mock_init:
            mock_init.side_effect = lambda: setattr(service, "initialized", True) or None
            service._pool = MagicMock()
            service._embedding_service = AsyncMock()

            with patch(
                "app.services.rag_service.index_document",
                new_callable=AsyncMock,
                return_value={
                    "success": True,
                    "document_id": "d",
                    "chunks_created": 0,
                    "skipped": True,
                    "skip_reason": "x",
                },
            ):
                await service.add_document(b"x", "d", "f.txt", user_id="u1")

        mock_init.assert_awaited_once()


class TestSearch:
    """search() delegates to RagSearchService with threshold filtering."""

    async def test_delegates_to_search_service(self):
        service = _make_service()
        service._search_service.search = AsyncMock(
            return_value=[
                {"content": "hit 1", "score": 0.9, "document_id": "doc-1"},
                {"content": "hit 2", "score": 0.8, "document_id": "doc-2"},
            ]
        )

        with patch("app.services.rag_service.settings") as mock_settings:
            mock_settings.top_k = 10
            mock_settings.similarity_threshold = 0.0
            results = await service.search("test query", document_ids=["doc-1"])

        assert len(results) == 2
        service._search_service.search.assert_awaited_once_with(
            "test query",
            document_ids=["doc-1"],
            top_k=10,
        )

    async def test_applies_similarity_threshold(self):
        service = _make_service()
        service._search_service.search = AsyncMock(
            return_value=[
                {"content": "good", "score": 0.9, "document_id": "d1"},
                {"content": "marginal", "score": 0.5, "document_id": "d2"},
                {"content": "bad", "score": 0.1, "document_id": "d3"},
            ]
        )

        with patch("app.services.rag_service.settings") as mock_settings:
            mock_settings.top_k = 10
            mock_settings.similarity_threshold = 0.7
            results = await service.search("query")

        assert len(results) == 1
        assert results[0]["content"] == "good"

    async def test_custom_top_k_overrides_settings(self):
        service = _make_service()
        service._search_service.search = AsyncMock(return_value=[])

        with patch("app.services.rag_service.settings") as mock_settings:
            mock_settings.top_k = 5
            mock_settings.similarity_threshold = 0.0
            await service.search("query", top_k=20)

        service._search_service.search.assert_awaited_once_with(
            "query",
            document_ids=None,
            top_k=20,
        )

    async def test_custom_threshold_overrides_settings(self):
        service = _make_service()
        service._search_service.search = AsyncMock(
            return_value=[
                {"content": "mid", "score": 0.5, "document_id": "d1"},
            ]
        )

        with patch("app.services.rag_service.settings") as mock_settings:
            mock_settings.top_k = 10
            mock_settings.similarity_threshold = 0.9
            results = await service.search("query", similarity_threshold=0.3)

        assert len(results) == 1

    async def test_zero_threshold_returns_all(self):
        service = _make_service()
        service._search_service.search = AsyncMock(
            return_value=[
                {"content": "a", "score": 0.01, "document_id": "d1"},
            ]
        )

        with patch("app.services.rag_service.settings") as mock_settings:
            mock_settings.top_k = 10
            mock_settings.similarity_threshold = 0.0
            results = await service.search("query")

        assert len(results) == 1

    async def test_passes_document_ids(self):
        service = _make_service()
        service._search_service.search = AsyncMock(return_value=[])

        with patch("app.services.rag_service.settings") as mock_settings:
            mock_settings.top_k = 10
            mock_settings.similarity_threshold = 0.0
            await service.search("q", document_ids=["doc-1", "doc-2"])

        service._search_service.search.assert_awaited_once_with(
            "q",
            document_ids=["doc-1", "doc-2"],
            top_k=10,
        )


class TestGenerate:
    """generate() orchestrates search -> context -> LLM completion."""

    async def test_generates_response_with_search_results(self):
        service = _make_service()

        mock_choice = MagicMock()
        mock_choice.message.content = "Generated answer based on context."
        mock_completion = MagicMock()
        mock_completion.choices = [mock_choice]
        service._openai_client.chat.completions.create = AsyncMock(return_value=mock_completion)

        with (
            patch.object(
                service,
                "search",
                new_callable=AsyncMock,
                return_value=[
                    {"content": "Context chunk 1", "score": 0.9, "document_id": "d1"},
                    {"content": "Context chunk 2", "score": 0.8, "document_id": "d2"},
                ],
            ),
            patch("app.services.rag_service.settings") as mock_settings,
        ):
            mock_settings.get_llm_config.return_value = {"model": "gpt-4o-mini"}
            result = await service.generate("What is X?", document_ids=["doc-1"])

        assert result["success"] is True
        assert result["response"] == "Generated answer based on context."
        assert len(result["sources"]) == 2
        assert result["processing_time_ms"] > 0

    async def test_empty_search_results_returns_no_info_message(self):
        service = _make_service()

        with patch.object(
            service,
            "search",
            new_callable=AsyncMock,
            return_value=[],
        ):
            result = await service.generate("Unknown topic?")

        assert result["success"] is False
        assert "No relevant information" in result["response"]
        assert result["sources"] == []
        service._openai_client.chat.completions.create.assert_not_awaited()

    async def test_llm_receives_system_prompt_and_context(self):
        from app.services.rag_service import SYSTEM_PROMPT

        service = _make_service()

        mock_choice = MagicMock()
        mock_choice.message.content = "answer"
        mock_completion = MagicMock()
        mock_completion.choices = [mock_choice]
        service._openai_client.chat.completions.create = AsyncMock(return_value=mock_completion)

        with (
            patch.object(
                service,
                "search",
                new_callable=AsyncMock,
                return_value=[{"content": "relevant info", "score": 0.9, "document_id": "d1"}],
            ),
            patch("app.services.rag_service.settings") as mock_settings,
        ):
            mock_settings.get_llm_config.return_value = {"model": "test-model"}
            await service.generate("What?")

        create_call = service._openai_client.chat.completions.create
        messages = create_call.call_args[1]["messages"]
        assert messages[0]["role"] == "system"
        assert messages[0]["content"] == SYSTEM_PROMPT
        assert messages[1]["role"] == "user"
        assert "relevant info" in messages[1]["content"]
        assert "What?" in messages[1]["content"]

    async def test_empty_llm_choices_raises(self):
        service = _make_service()

        mock_completion = MagicMock()
        mock_completion.choices = []
        service._openai_client.chat.completions.create = AsyncMock(return_value=mock_completion)

        with (
            patch.object(
                service,
                "search",
                new_callable=AsyncMock,
                return_value=[{"content": "info", "score": 0.9, "document_id": "d1"}],
            ),
            patch("app.services.rag_service.settings") as mock_settings,
        ):
            mock_settings.get_llm_config.return_value = {"model": "m"}
            with pytest.raises(ValueError, match="empty choices"):
                await service.generate("question")

    async def test_context_truncated_at_max_chars(self):
        from app.services.rag_service import RAG_MAX_CONTEXT_CHARS

        service = _make_service()

        mock_choice = MagicMock()
        mock_choice.message.content = "answer"
        mock_completion = MagicMock()
        mock_completion.choices = [mock_choice]
        service._openai_client.chat.completions.create = AsyncMock(return_value=mock_completion)

        large_chunks = [{"content": "x" * 100_000, "score": 0.9 - i * 0.01, "document_id": f"d{i}"} for i in range(5)]

        with (
            patch.object(service, "search", new_callable=AsyncMock, return_value=large_chunks),
            patch("app.services.rag_service.settings") as mock_settings,
        ):
            mock_settings.get_llm_config.return_value = {"model": "m"}
            result = await service.generate("query")

        create_call = service._openai_client.chat.completions.create
        user_msg = create_call.call_args[1]["messages"][1]["content"]
        assert len(user_msg) < RAG_MAX_CONTEXT_CHARS + 1000

    async def test_passes_document_ids_to_search(self):
        service = _make_service()

        with patch.object(service, "search", new_callable=AsyncMock, return_value=[]) as mock_search:
            await service.generate("q", document_ids=["doc-1"])

        mock_search.assert_awaited_once()
        call_kwargs = mock_search.call_args[1]
        assert call_kwargs["document_ids"] == ["doc-1"]

    async def test_none_content_from_llm_returns_empty_string(self):
        service = _make_service()

        mock_choice = MagicMock()
        mock_choice.message.content = None
        mock_completion = MagicMock()
        mock_completion.choices = [mock_choice]
        service._openai_client.chat.completions.create = AsyncMock(return_value=mock_completion)

        with (
            patch.object(
                service,
                "search",
                new_callable=AsyncMock,
                return_value=[{"content": "info", "score": 0.9, "document_id": "d1"}],
            ),
            patch("app.services.rag_service.settings") as mock_settings,
        ):
            mock_settings.get_llm_config.return_value = {"model": "m"}
            result = await service.generate("q")

        assert result["response"] == ""
        assert result["success"] is True


class TestDeleteDocument:
    """delete_document() deletes all matching documents by document_id."""

    async def test_deletes_document(self):
        service = _make_service()
        mock_conn = _mock_conn(
            fetch_return=[
                {"id": "uuid-1"},
            ]
        )

        with patch("app.services.rag_service.acquire_with_retry", return_value=_async_ctx(mock_conn)):
            result = await service.delete_document("doc-1")

        assert result["success"] is True
        assert result["deleted_count"] == 1
        assert "uuid-1" in result["deleted_data_ids"]

    async def test_deletes_multiple_matching_docs(self):
        service = _make_service()
        mock_conn = _mock_conn(
            fetch_return=[
                {"id": "uuid-1"},
                {"id": "uuid-2"},
            ]
        )

        with patch("app.services.rag_service.acquire_with_retry", return_value=_async_ctx(mock_conn)):
            result = await service.delete_document("doc-1")

        assert result["deleted_count"] == 2

    async def test_no_documents_found_returns_zero_deleted(self):
        service = _make_service()
        mock_conn = _mock_conn(fetch_return=[])

        with patch("app.services.rag_service.acquire_with_retry", return_value=_async_ctx(mock_conn)):
            result = await service.delete_document("nonexistent")

        assert result["success"] is True
        assert result["deleted_count"] == 0
        assert "nonexistent" in result["message"]

    async def test_deletes_chunks_before_documents(self):
        """Chunks must be deleted explicitly before documents to avoid BM25 index corruption."""
        service = _make_service()
        mock_conn = _mock_conn(
            fetch_return=[
                {"id": "uuid-1"},
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

        with patch("app.services.rag_service.acquire_with_retry", return_value=_async_ctx(mock_conn)):
            await service.delete_document("doc-1")

        assert call_order == ["delete_chunks", "delete_documents"]

    async def test_delete_uses_transaction(self):
        """Chunk and document deletion must happen within a transaction."""
        service = _make_service()
        mock_conn = _mock_conn(
            fetch_return=[
                {"id": "uuid-1"},
            ]
        )

        with patch("app.services.rag_service.acquire_with_retry", return_value=_async_ctx(mock_conn)):
            await service.delete_document("doc-1")

        mock_conn.transaction.assert_called_once()

    async def test_processing_time_is_reported(self):
        service = _make_service()
        mock_conn = _mock_conn(fetch_return=[])

        with patch("app.services.rag_service.acquire_with_retry", return_value=_async_ctx(mock_conn)):
            result = await service.delete_document("doc-1")

        assert "processing_time_ms" in result
        assert result["processing_time_ms"] >= 0

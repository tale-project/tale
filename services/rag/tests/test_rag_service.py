"""Tests for the main RagService orchestrator.

Covers:
- add_document() with single team, user, and multiple targets
- search() delegation to RagSearchService with threshold filtering
- generate() with search results and empty results
- delete_document() with team authorization checks
- Error propagation from sub-services
"""

from __future__ import annotations

import time
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytestmark = pytest.mark.asyncio

TEST_ORG = "test-org"


def _make_service():
    """Create a RagService with all internal dependencies pre-mocked.

    Bypasses initialize() by directly setting the internal state, and
    pre-seeds the per-org client cache for `TEST_ORG` so tests don't
    have to drive the lazy-init path.
    """
    from app.services.rag_service import RagService, _OrgClients
    from app.services.vector_store import VectorDbConfig

    service = RagService()
    service.initialized = True
    service._pool = MagicMock()
    service._pinned_dims = 1536

    embedding = AsyncMock()
    embedding.dimensions = 1536
    openai_client = AsyncMock()
    vision_client = MagicMock()
    search_service = AsyncMock()
    # Built-in store: requires_index_sync=False so add_document's external
    # mirror block is skipped (these tests don't exercise external backends).
    vector_store = AsyncMock()
    vector_store.requires_index_sync = False
    vector_store.backend_name = "pgvector"

    service._org_clients[TEST_ORG] = _OrgClients(
        llm_config={
            "model": "gpt-test",
            "embedding_model": "embed-test",
            "api_key": "k",
            "base_url": "http://test",
            "embedding_api_key": "k",
            "embedding_base_url": "http://test",
        },
        vision_config=None,
        embedding_service=embedding,
        openai_client=openai_client,
        vision_client=vision_client,
        search_service=search_service,
        vector_store=vector_store,
        vectordb_config=VectorDbConfig(),
        last_check=time.monotonic(),
    )
    # Back-compat aliases for tests that grab the mocks directly off the
    # service. Both names point at the SAME mock instance the per-org
    # cache uses, so setup-then-assert via either attribute works.
    service._search_service = search_service
    service._openai_client = openai_client
    service._embedding_service = embedding
    service._vision_client = vision_client
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
            "file_id": "doc-1",
            "chunks_created": 5,
            "skipped": False,
            "skip_reason": None,
        }

        with patch(
            "app.services.rag_service.index_document", new_callable=AsyncMock, return_value=index_result
        ) as mock_idx:
            result = await service.add_document(
                TEST_ORG,
                b"content bytes",
                "doc-1",
                "report.pdf",
            )

        assert result["success"] is True
        assert result["file_id"] == "doc-1"
        assert result["chunks_created"] == 5
        mock_idx.assert_awaited_once()

    async def test_skipped_returns_skipped(self):
        service = _make_service()
        index_result = {
            "success": True,
            "file_id": "doc-skip",
            "chunks_created": 0,
            "skipped": True,
            "skip_reason": "content_unchanged",
        }

        with patch("app.services.rag_service.index_document", new_callable=AsyncMock, return_value=index_result):
            result = await service.add_document(
                TEST_ORG,
                b"content",
                "doc-skip",
                "file.txt",
            )

        assert result["skipped"] is True
        assert result["skip_reason"] == "content_unchanged"

    async def test_initializes_if_not_initialized(self):
        """`add_document` triggers `initialize()` (sets up the DB pool)
        on the first call. Under the multi-org refactor, per-org client
        construction is deferred even further (lazy on first call for
        that org), so we pre-seed the cache to bypass _ensure_org_clients
        and only verify the DB-pool initialize gate fires."""
        from app.services.rag_service import RagService, _OrgClients
        from app.services.vector_store import VectorDbConfig

        service = RagService()
        assert service.initialized is False

        with patch.object(service, "initialize", new_callable=AsyncMock) as mock_init:

            def _fake_init():
                service.initialized = True
                # Pre-seed per-org cache so the inner _ensure_org_clients
                # call inside add_document doesn't try to read a real
                # provider catalog from disk.
                embedding = AsyncMock()
                embedding.dimensions = 1536
                service._pinned_dims = 1536
                vector_store = AsyncMock()
                vector_store.requires_index_sync = False
                vector_store.backend_name = "pgvector"
                service._org_clients[TEST_ORG] = _OrgClients(
                    llm_config={
                        "model": "gpt",
                        "embedding_model": "embed",
                        "api_key": "k",
                        "base_url": "u",
                        "embedding_api_key": "k",
                        "embedding_base_url": "u",
                    },
                    vision_config=None,
                    embedding_service=embedding,
                    openai_client=AsyncMock(),
                    vision_client=MagicMock(),
                    search_service=AsyncMock(),
                    vector_store=vector_store,
                    vectordb_config=VectorDbConfig(),
                    last_check=time.monotonic(),
                )

            mock_init.side_effect = _fake_init
            service._pool = MagicMock()

            with patch(
                "app.services.rag_service.index_document",
                new_callable=AsyncMock,
                return_value={
                    "success": True,
                    "file_id": "d",
                    "chunks_created": 0,
                    "skipped": True,
                    "skip_reason": "x",
                },
            ):
                await service.add_document(TEST_ORG, b"x", "d", "f.txt")

        mock_init.assert_awaited_once()


class TestSearch:
    """search() delegates to RagSearchService with threshold filtering."""

    async def test_delegates_to_search_service(self):
        service = _make_service()
        usage_obj = MagicMock(name="usage")
        service._search_service.search = AsyncMock(
            return_value=(
                [
                    {"content": "hit 1", "score": 0.9, "file_id": "doc-1"},
                    {"content": "hit 2", "score": 0.8, "file_id": "doc-2"},
                ],
                usage_obj,
            )
        )

        with patch("app.services.rag_service.settings") as mock_settings:
            mock_settings.top_k = 10
            mock_settings.similarity_threshold = 0.0
            results, usage = await service.search(TEST_ORG, "test query", file_ids=["doc-1"])

        assert len(results) == 2
        # `search_service.search` now returns the `(results, usage)`
        # tuple directly — no shared singleton attribute to read.
        assert usage is usage_obj
        service._search_service.search.assert_awaited_once_with(
            TEST_ORG,
            "test query",
            file_ids=["doc-1"],
            top_k=10,
            similarity_threshold=0.0,
        )

    async def test_applies_similarity_threshold(self):
        service = _make_service()
        service._search_service.search = AsyncMock(return_value=([], MagicMock()))

        with patch("app.services.rag_service.settings") as mock_settings:
            mock_settings.top_k = 10
            mock_settings.similarity_threshold = 0.7
            await service.search(TEST_ORG, "query")

        # Threshold is now passed to search_service for vector pre-filtering
        service._search_service.search.assert_awaited_once_with(
            TEST_ORG,
            "query",
            file_ids=None,
            top_k=10,
            similarity_threshold=0.7,
        )

    async def test_custom_top_k_overrides_settings(self):
        service = _make_service()
        service._search_service.search = AsyncMock(return_value=([], MagicMock()))

        with patch("app.services.rag_service.settings") as mock_settings:
            mock_settings.top_k = 5
            mock_settings.similarity_threshold = 0.0
            await service.search(TEST_ORG, "query", top_k=20)

        service._search_service.search.assert_awaited_once_with(
            TEST_ORG,
            "query",
            file_ids=None,
            top_k=20,
            similarity_threshold=0.0,
        )

    async def test_custom_threshold_overrides_settings(self):
        service = _make_service()
        service._search_service.search = AsyncMock(
            return_value=(
                [{"content": "mid", "score": 0.5, "file_id": "d1"}],
                MagicMock(),
            )
        )

        with patch("app.services.rag_service.settings") as mock_settings:
            mock_settings.top_k = 10
            mock_settings.similarity_threshold = 0.9
            results, _usage = await service.search(TEST_ORG, "query", similarity_threshold=0.3)

        assert len(results) == 1

    async def test_zero_threshold_returns_all(self):
        service = _make_service()
        service._search_service.search = AsyncMock(
            return_value=(
                [{"content": "a", "score": 0.01, "file_id": "d1"}],
                MagicMock(),
            )
        )

        with patch("app.services.rag_service.settings") as mock_settings:
            mock_settings.top_k = 10
            mock_settings.similarity_threshold = 0.0
            results, _usage = await service.search(TEST_ORG, "query")

        assert len(results) == 1

    async def test_passes_file_ids(self):
        service = _make_service()
        service._search_service.search = AsyncMock(return_value=([], MagicMock()))
        service.get_document_statuses = AsyncMock(return_value={"doc-1": None, "doc-2": None})

        with patch("app.services.rag_service.settings") as mock_settings:
            mock_settings.top_k = 10
            mock_settings.similarity_threshold = 0.0
            await service.search(TEST_ORG, "q", file_ids=["doc-1", "doc-2"])

        service._search_service.search.assert_awaited_once_with(
            TEST_ORG,
            "q",
            file_ids=["doc-1", "doc-2"],
            top_k=10,
            similarity_threshold=0.0,
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
                # `search` returns `(results, usage)` — usage is None
                # here since we only care about the LLM completion side.
                return_value=(
                    [
                        {"content": "Context chunk 1", "score": 0.9, "file_id": "d1"},
                        {"content": "Context chunk 2", "score": 0.8, "file_id": "d2"},
                    ],
                    None,
                ),
            ),
            patch("app.services.rag_service.settings") as mock_settings,
        ):
            mock_settings.get_llm_config.return_value = {"model": "gpt-4o-mini"}
            result = await service.generate(TEST_ORG, "What is X?", file_ids=["doc-1"])

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
            return_value=([], None),
        ):
            result = await service.generate(TEST_ORG, "Unknown topic?")

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
                return_value=(
                    [{"content": "relevant info", "score": 0.9, "file_id": "d1"}],
                    None,
                ),
            ),
            patch("app.services.rag_service.settings") as mock_settings,
        ):
            mock_settings.get_llm_config.return_value = {"model": "test-model"}
            await service.generate(TEST_ORG, "What?")

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
                return_value=(
                    [{"content": "info", "score": 0.9, "file_id": "d1"}],
                    None,
                ),
            ),
            patch("app.services.rag_service.settings") as mock_settings,
        ):
            mock_settings.get_llm_config.return_value = {"model": "m"}
            with pytest.raises(ValueError, match="empty choices"):
                await service.generate(TEST_ORG, "question")

    async def test_context_truncated_at_max_chars(self):
        from app.services.rag_service import RAG_MAX_CONTEXT_CHARS

        service = _make_service()

        mock_choice = MagicMock()
        mock_choice.message.content = "answer"
        mock_completion = MagicMock()
        mock_completion.choices = [mock_choice]
        service._openai_client.chat.completions.create = AsyncMock(return_value=mock_completion)

        large_chunks = [{"content": "x" * 100_000, "score": 0.9 - i * 0.01, "file_id": f"d{i}"} for i in range(5)]

        with (
            patch.object(
                service,
                "search",
                new_callable=AsyncMock,
                return_value=(large_chunks, None),
            ),
            patch("app.services.rag_service.settings") as mock_settings,
        ):
            mock_settings.get_llm_config.return_value = {"model": "m"}
            result = await service.generate(TEST_ORG, "query")

        create_call = service._openai_client.chat.completions.create
        user_msg = create_call.call_args[1]["messages"][1]["content"]
        assert len(user_msg) < RAG_MAX_CONTEXT_CHARS + 1000

    async def test_passes_file_ids_to_search(self):
        service = _make_service()

        with patch.object(
            service,
            "search",
            new_callable=AsyncMock,
            return_value=([], None),
        ) as mock_search:
            await service.generate(TEST_ORG, "q", file_ids=["doc-1"])

        mock_search.assert_awaited_once()
        call_kwargs = mock_search.call_args[1]
        assert call_kwargs["file_ids"] == ["doc-1"]

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
                return_value=(
                    [{"content": "info", "score": 0.9, "file_id": "d1"}],
                    None,
                ),
            ),
            patch("app.services.rag_service.settings") as mock_settings,
        ):
            mock_settings.get_llm_config.return_value = {"model": "m"}
            result = await service.generate(TEST_ORG, "q")

        assert result["response"] == ""
        assert result["success"] is True


class TestDeleteDocument:
    """delete_document() deletes all matching documents by file_id."""

    async def test_deletes_document(self):
        service = _make_service()
        mock_conn = _mock_conn(
            fetch_return=[
                {"id": "uuid-1"},
            ]
        )

        with patch("app.services.rag_service.acquire_with_retry", return_value=_async_ctx(mock_conn)):
            result = await service.delete_document(TEST_ORG, "doc-1")

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
            result = await service.delete_document(TEST_ORG, "doc-1")

        assert result["deleted_count"] == 2

    async def test_no_documents_found_returns_zero_deleted(self):
        service = _make_service()
        mock_conn = _mock_conn(fetch_return=[])

        with patch("app.services.rag_service.acquire_with_retry", return_value=_async_ctx(mock_conn)):
            result = await service.delete_document(TEST_ORG, "nonexistent")

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
            await service.delete_document(TEST_ORG, "doc-1")

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
            await service.delete_document(TEST_ORG, "doc-1")

        mock_conn.transaction.assert_called_once()

    async def test_processing_time_is_reported(self):
        service = _make_service()
        mock_conn = _mock_conn(fetch_return=[])

        with patch("app.services.rag_service.acquire_with_retry", return_value=_async_ctx(mock_conn)):
            result = await service.delete_document(TEST_ORG, "doc-1")

        assert "processing_time_ms" in result
        assert result["processing_time_ms"] >= 0

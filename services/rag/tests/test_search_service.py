"""Tests for RagSearchService hybrid search.

Covers:
- Hybrid search (FTS + vector) with RRF fusion
- Scope filtering (file_ids, none)
- Graceful fallback when BM25 index not ready
- UndefinedTableError / UndefinedColumnError handling
- Empty results from both search channels
- Recency boost scoring
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import asyncpg
import pytest
from tale_knowledge.embedding import EmbeddingQueryResult, EmbeddingUsage

pytestmark = pytest.mark.asyncio

TEST_ORG = "test-org"


def _make_row(
    row_id: int, chunk_content: str, file_id: str, score: float = 1.0, chunk_index: int = 0
) -> dict[str, Any]:
    return {
        "id": row_id,
        "chunk_content": chunk_content,
        "chunk_index": chunk_index,
        "file_id": file_id,
        "score": score,
    }


def _build_service(
    *,
    fts_rows: list[dict[str, Any]] | None = None,
    fts_side_effect: Exception | None = None,
    vector_rows: list[dict[str, Any]] | None = None,
    vector_side_effect: Exception | None = None,
    embed_return: list[float] | None = None,
):
    """Build a RagSearchService with mocked pool and embedding service.

    Two separate mock connections are used: the first `conn.fetch` call
    serves the FTS query, the second serves the vector query.
    """
    from app.services.search_service import RagSearchService

    fts_conn = AsyncMock()
    if fts_side_effect:
        fts_conn.fetch = AsyncMock(side_effect=fts_side_effect)
    else:
        fts_conn.fetch = AsyncMock(
            return_value=[
                MagicMock(**{"__iter__": lambda s: iter(r), "keys": lambda s: r.keys(), **{k: v for k, v in r.items()}})
                for r in (fts_rows or [])
            ]
        )

    vector_conn = AsyncMock()
    if vector_side_effect:
        vector_conn.fetch = AsyncMock(side_effect=vector_side_effect)
    else:
        vector_conn.fetch = AsyncMock(
            return_value=[
                MagicMock(**{"__iter__": lambda s: iter(r), "keys": lambda s: r.keys(), **{k: v for k, v in r.items()}})
                for r in (vector_rows or [])
            ]
        )

    pool = MagicMock()

    embedding_service = AsyncMock()
    embedding_service.embed_query_with_usage = AsyncMock(
        return_value=EmbeddingQueryResult(
            embedding=embed_return or [0.1, 0.2, 0.3],
            usage=EmbeddingUsage(prompt_tokens=0, total_tokens=0, model="test-model"),
        )
    )

    service = RagSearchService(pool, embedding_service)
    return service, pool, embedding_service, fts_conn, vector_conn


class TestHybridSearch:
    """Happy-path hybrid search combining FTS and vector results."""

    async def test_merges_fts_and_vector_results(self):
        fts_rows = [_make_row(1, "FTS result A", "doc-1", 5.0)]
        vector_rows = [_make_row(2, "Vector result B", "doc-2", 0.9)]

        service, pool, embed_svc, fts_conn, vector_conn = _build_service(
            fts_rows=fts_rows,
            vector_rows=vector_rows,
        )

        with patch("app.services.search_service.acquire_with_retry") as mock_acq:
            enter_mock = AsyncMock()
            call_count = 0

            async def side_effect_fn(*_args, **_kwargs):
                nonlocal call_count
                call_count += 1
                return fts_conn if call_count == 1 else vector_conn

            mock_ctx = AsyncMock()
            mock_ctx.__aenter__ = side_effect_fn
            mock_ctx.__aexit__ = AsyncMock(return_value=False)
            mock_acq.return_value = mock_ctx

            # Mock _fts_search and _vector_search directly for cleaner testing
            service._fts_search = AsyncMock(return_value=fts_rows)
            service._vector_search = AsyncMock(return_value=vector_rows)

            results, _usage = await service.search(TEST_ORG, "test query", file_ids=["doc-1"])

        assert len(results) > 0
        for r in results:
            assert "content" in r
            assert "score" in r
            assert "file_id" in r

    async def test_returns_empty_when_both_channels_empty(self):
        service, *_ = _build_service(fts_rows=[], vector_rows=[])

        service._fts_search = AsyncMock(return_value=[])
        service._vector_search = AsyncMock(return_value=[])

        results, _usage = await service.search(TEST_ORG, "nothing here")

        assert results == []

    async def test_fts_only_results(self):
        fts_rows = [
            _make_row(1, "Only FTS hit", "doc-1", 3.0),
            _make_row(2, "Another FTS hit", "doc-2", 2.0),
        ]
        service, *_ = _build_service(fts_rows=fts_rows, vector_rows=[])

        service._fts_search = AsyncMock(return_value=fts_rows)
        service._vector_search = AsyncMock(return_value=[])

        results, _usage = await service.search(TEST_ORG, "fts query")

        assert len(results) == 2
        assert results[0]["content"] == "Only FTS hit"

    async def test_vector_only_results(self):
        vector_rows = [_make_row(10, "Vector hit", "doc-v", 0.95)]
        service, *_ = _build_service(fts_rows=[], vector_rows=vector_rows)

        service._fts_search = AsyncMock(return_value=[])
        service._vector_search = AsyncMock(return_value=vector_rows)

        results, _usage = await service.search(TEST_ORG, "vector query")

        assert len(results) == 1
        assert results[0]["content"] == "Vector hit"

    async def test_top_k_limits_results(self):
        fts_rows = [_make_row(i, f"chunk-{i}", "doc-1") for i in range(20)]
        vector_rows = [_make_row(100 + i, f"vchunk-{i}", "doc-2") for i in range(20)]

        service, *_ = _build_service()
        service._fts_search = AsyncMock(return_value=fts_rows)
        service._vector_search = AsyncMock(return_value=vector_rows)

        results, _usage = await service.search(TEST_ORG, "query", top_k=5)

        assert len(results) <= 5

    async def test_embedding_service_called_with_query(self):
        service, _, embed_svc, *_ = _build_service()
        service._fts_search = AsyncMock(return_value=[])
        service._vector_search = AsyncMock(return_value=[])

        await service.search(TEST_ORG, "my search query")

        embed_svc.embed_query_with_usage.assert_awaited_once_with("my search query")


class TestScopeFiltering:
    """Scope clause construction and parameter passing."""

    def test_build_scope_clause_with_file_ids(self):
        from app.services.search_service import RagSearchService

        pool = MagicMock()
        embed = MagicMock()
        service = RagSearchService(pool, embed)

        clause, params = service._build_scope_clause(TEST_ORG, ["doc-a", "doc-b"], 1)

        # org filter is ALWAYS present; file_id filter is additive.
        assert "org_slug" in clause
        assert "$2" in clause  # org param at offset+1
        assert "file_id" in clause
        assert "ANY($3)" in clause  # file_ids at offset+2
        assert params == [TEST_ORG, ["doc-a", "doc-b"]]

    def test_build_scope_clause_without_file_ids(self):
        from app.services.search_service import RagSearchService

        pool = MagicMock()
        embed = MagicMock()
        service = RagSearchService(pool, embed)

        clause, params = service._build_scope_clause(TEST_ORG, None, 1)

        # Empty/None file_ids now produces an org-only filter (not "").
        assert "org_slug" in clause
        assert "file_id" not in clause
        assert params == [TEST_ORG]

    def test_build_scope_clause_respects_param_offset(self):
        from app.services.search_service import RagSearchService

        pool = MagicMock()
        embed = MagicMock()
        service = RagSearchService(pool, embed)

        clause, params = service._build_scope_clause(TEST_ORG, ["doc-a"], 3)

        # org param at offset+1 = $4, file_ids at offset+2 = $5.
        assert "$4" in clause
        assert "$5" in clause

    async def test_search_passes_file_ids_to_fts_and_vector(self):
        service, *_ = _build_service()
        service._fts_search = AsyncMock(return_value=[])
        service._vector_search = AsyncMock(return_value=[])

        await service.search(TEST_ORG, "query", file_ids=["doc-1", "doc-2"])

        # _fts_search signature is now (query, org_slug, file_ids, limit)
        service._fts_search.assert_awaited_once()
        fts_args = service._fts_search.call_args
        assert fts_args[0][1] == TEST_ORG
        assert fts_args[0][2] == ["doc-1", "doc-2"]

        # _vector_search signature is (embedding, org_slug, file_ids, limit)
        service._vector_search.assert_awaited_once()
        vec_args = service._vector_search.call_args
        assert vec_args[0][1] == TEST_ORG
        assert vec_args[0][2] == ["doc-1", "doc-2"]


class TestFolderPathScope:
    """Folder-path prefix filtering in the scope clause and search()."""

    def _service(self):
        from app.services.search_service import RagSearchService

        return RagSearchService(MagicMock(), MagicMock())

    def test_scope_clause_with_folder_path_only(self):
        service = self._service()

        clause, params = service._build_scope_clause(TEST_ORG, None, 1, folder_path="data-room")

        # Folder filter alone still requires the org-scoped documents subquery.
        assert "org_slug" in clause
        assert "SELECT id FROM" in clause
        assert "file_id" not in clause
        # Boundary-safe prefix: exact match OR prefix followed by '/'.
        assert "folder_path = $3" in clause
        assert "left(folder_path, char_length($3) + 1) = $3 || '/'" in clause
        assert params == [TEST_ORG, "data-room"]

    def test_scope_clause_with_folder_path_and_file_ids(self):
        service = self._service()

        clause, params = service._build_scope_clause(TEST_ORG, ["doc-a"], 1, folder_path="data-room")

        assert "ANY($3)" in clause
        assert "folder_path = $4" in clause
        assert params == [TEST_ORG, ["doc-a"], "data-room"]

    def test_scope_clause_folder_path_respects_param_offset(self):
        service = self._service()

        clause, params = service._build_scope_clause(TEST_ORG, ["doc-a"], 3, folder_path="x")

        # org at $4, file_ids at $5, folder_path at $6.
        assert "$4" in clause
        assert "ANY($5)" in clause
        assert "folder_path = $6" in clause
        assert params == [TEST_ORG, ["doc-a"], "x"]

    def test_scope_clause_without_folder_path_unchanged(self):
        service = self._service()

        clause, params = service._build_scope_clause(TEST_ORG, None, 1)

        assert "folder_path" not in clause
        assert params == [TEST_ORG]

    async def test_search_passes_folder_path_to_fts_and_vector(self):
        service, *_ = _build_service()
        service._fts_search = AsyncMock(return_value=[])
        service._vector_search = AsyncMock(return_value=[])

        await service.search(TEST_ORG, "query", file_ids=["doc-1"], folder_path="contracts/2024")

        assert service._fts_search.call_args.kwargs["folder_path"] == "contracts/2024"
        assert service._vector_search.call_args.kwargs["folder_path"] == "contracts/2024"

    async def test_semantic_cache_bypassed_when_folder_path_set(self):
        service, *_ = _build_service()
        service._fts_search = AsyncMock(return_value=[_make_row(1, "hit", "doc-1", 5.0)])
        service._vector_search = AsyncMock(return_value=[])
        cache = AsyncMock()
        cache.lookup = AsyncMock(return_value=None)
        cache.store = AsyncMock()
        service._semantic_cache = cache

        results, _usage = await service.search(TEST_ORG, "query", folder_path="contracts")

        assert len(results) == 1
        cache.lookup.assert_not_awaited()
        cache.store.assert_not_awaited()

    async def test_semantic_cache_used_without_folder_path(self):
        service, *_ = _build_service()
        service._fts_search = AsyncMock(return_value=[_make_row(1, "hit", "doc-1", 5.0)])
        service._vector_search = AsyncMock(return_value=[])
        cache = AsyncMock()
        cache.lookup = AsyncMock(return_value=None)
        cache.store = AsyncMock()
        service._semantic_cache = cache

        results, _usage = await service.search(TEST_ORG, "query")

        assert len(results) == 1
        cache.lookup.assert_awaited_once()
        cache.store.assert_awaited_once()

    async def test_bm25_fallback_keeps_folder_path(self):
        vector_rows = [_make_row(1, "vec result", "doc-1", 0.9)]
        service, *_ = _build_service()

        with patch.object(service, "_fts_search", side_effect=asyncpg.InternalServerError("bm25 index not found")):
            with patch.object(service, "_vector_search", new_callable=AsyncMock) as mock_vec:
                mock_vec.return_value = vector_rows
                with patch.object(service._embedding, "embed_query", return_value=[0.1]):
                    results, _usage = await service.search(TEST_ORG, "query", folder_path="contracts")

        assert len(results) == 1
        assert mock_vec.call_args.kwargs["folder_path"] == "contracts"


class TestMetadataFilterScope:
    """Metadata pre-filtering in the scope clause and search() (#1517)."""

    def _service(self):
        from app.services.search_service import RagSearchService

        return RagSearchService(MagicMock(), MagicMock())

    def test_scope_clause_with_scalar_equality(self):
        service = self._service()

        clause, params = service._build_scope_clause(
            TEST_ORG, None, 1, metadata_filters={"department": "legal", "year": 2023}
        )

        assert "org_slug" in clause
        assert "SELECT id FROM" in clause
        assert "metadata @> $3::jsonb" in clause
        assert params == [TEST_ORG, '{"department": "legal", "year": 2023}']

    def test_scope_clause_with_in_list(self):
        service = self._service()

        clause, params = service._build_scope_clause(TEST_ORG, None, 1, metadata_filters={"year": [2023, 2024]})

        # Key and values are bound parameters, never interpolated.
        assert "metadata->>$3 = ANY($4)" in clause
        assert params == [TEST_ORG, "year", ["2023", "2024"]]

    def test_in_list_values_use_jsonb_text_form(self):
        service = self._service()

        _clause, params = service._build_scope_clause(
            TEST_ORG, None, 1, metadata_filters={"flag": [True, False], "name": ["a"]}
        )

        # Booleans render as jsonb text ('true'), strings stay raw.
        assert params == [TEST_ORG, "flag", ["true", "false"], "name", ["a"]]

    def test_scope_clause_combines_all_filters_with_offsets(self):
        service = self._service()

        clause, params = service._build_scope_clause(
            TEST_ORG,
            ["doc-a"],
            3,
            folder_path="data-room",
            metadata_filters={"department": "legal", "year": [2023]},
        )

        # org at $4, file_ids at $5, folder at $6, equality jsonb at $7,
        # IN-key at $8, IN-values at $9.
        assert "c.org_slug = $4" in clause
        assert "ANY($5)" in clause
        assert "folder_path = $6" in clause
        assert "metadata @> $7::jsonb" in clause
        assert "metadata->>$8 = ANY($9)" in clause
        assert params == [
            TEST_ORG,
            ["doc-a"],
            "data-room",
            '{"department": "legal"}',
            "year",
            ["2023"],
        ]

    def test_scope_clause_without_metadata_unchanged(self):
        service = self._service()

        clause, params = service._build_scope_clause(TEST_ORG, None, 1)

        assert "metadata" not in clause
        assert params == [TEST_ORG]

    async def test_search_passes_metadata_filters_to_fts_and_vector(self):
        service, *_ = _build_service()
        service._fts_search = AsyncMock(return_value=[])
        service._vector_search = AsyncMock(return_value=[])

        await service.search(TEST_ORG, "query", metadata_filters={"department": "legal"})

        assert service._fts_search.call_args.kwargs["metadata_filters"] == {"department": "legal"}
        assert service._vector_search.call_args.kwargs["metadata_filters"] == {"department": "legal"}

    async def test_semantic_cache_bypassed_when_metadata_filters_set(self):
        service, *_ = _build_service()
        service._fts_search = AsyncMock(return_value=[_make_row(1, "hit", "doc-1", 5.0)])
        service._vector_search = AsyncMock(return_value=[])
        cache = AsyncMock()
        cache.lookup = AsyncMock(return_value=None)
        cache.store = AsyncMock()
        service._semantic_cache = cache

        results, _usage = await service.search(TEST_ORG, "query", metadata_filters={"year": 2024})

        assert len(results) == 1
        cache.lookup.assert_not_awaited()
        cache.store.assert_not_awaited()

    async def test_bm25_fallback_keeps_metadata_filters(self):
        vector_rows = [_make_row(1, "vec result", "doc-1", 0.9)]
        service, *_ = _build_service()

        with patch.object(service, "_fts_search", side_effect=asyncpg.InternalServerError("bm25 index not found")):
            with patch.object(service, "_vector_search", new_callable=AsyncMock) as mock_vec:
                mock_vec.return_value = vector_rows
                with patch.object(service._embedding, "embed_query", return_value=[0.1]):
                    results, _usage = await service.search(TEST_ORG, "query", metadata_filters={"a": "b"})

        assert len(results) == 1
        assert mock_vec.call_args.kwargs["metadata_filters"] == {"a": "b"}


class TestReranking:
    """Cross-encoder re-ranking wiring: pool widening, fallback, creds."""

    def test_shared_reranker_is_a_singleton_with_creds(self):
        import app.services.search_service as ss

        with patch.object(ss, "_shared_reranker", None):
            with patch("app.services.search_service.settings") as mock_settings:
                mock_settings.reranking_model = "model-x"
                mock_settings.reranking_provider = "api"
                mock_settings.reranking_api_base_url = "https://rerank.example"
                mock_settings.reranking_api_key = "key-1"

                first = ss._get_shared_reranker()
                second = ss._get_shared_reranker()

        assert first is second
        assert first._model_name == "model-x"
        assert first._provider == "api"
        assert first._api_base_url == "https://rerank.example"
        assert first._api_key == "key-1"

    async def test_rerank_failure_falls_back_to_rrf_order(self):
        fts_rows = [_make_row(i, f"chunk-{i}", "doc-1") for i in range(10)]
        service, *_ = _build_service()
        service._fts_search = AsyncMock(return_value=fts_rows)
        service._vector_search = AsyncMock(return_value=[])
        service._reranker = AsyncMock()
        service._reranker.rerank = AsyncMock(side_effect=ImportError("sentence-transformers not installed"))

        results, _usage = await service.search(TEST_ORG, "query", top_k=3)

        # Never 500s; RRF order trimmed to top_k.
        assert len(results) == 3
        assert results[0]["content"] == "chunk-0"

    async def test_rerank_rescores_widened_pool_and_trims(self):
        fts_rows = [_make_row(i, f"chunk-{i}", "doc-1") for i in range(40)]
        service, *_ = _build_service()
        service._fts_search = AsyncMock(return_value=fts_rows)
        service._vector_search = AsyncMock(return_value=[])
        service._reranker = AsyncMock()

        async def fake_rerank(_query, items, *, top_k):
            for i, item in enumerate(items):
                item["reranking_score"] = 1.0 - i * 0.01
            return list(reversed(items))[:top_k]

        service._reranker.rerank = AsyncMock(side_effect=fake_rerank)

        with patch("app.services.search_service.settings") as mock_settings:
            mock_settings.recency_boost_enabled = False
            mock_settings.semantic_cache_enabled = False
            mock_settings.reranking_candidates = 30
            mock_settings.reranking_top_k = 10

            results, _usage = await service.search(TEST_ORG, "query", top_k=5)

        # Pool fed to the reranker is the widened RRF pool, not top_k.
        rerank_items = service._reranker.rerank.call_args[0][1]
        assert len(rerank_items) == 30
        # Response respects min(top_k, reranking_top_k).
        assert service._reranker.rerank.call_args.kwargs["top_k"] == 5
        assert len(results) == 5
        # Reranker output order wins over RRF order.
        assert results[0]["content"] == "chunk-29"

    async def test_rerank_input_carries_content_key(self):
        rows = [
            {**_make_row(1, "raw chunk", "doc-1", 5.0), "core_content": "core span"},
        ]
        service, *_ = _build_service()
        service._fts_search = AsyncMock(return_value=rows)
        service._vector_search = AsyncMock(return_value=[])
        service._reranker = AsyncMock()
        service._reranker.rerank = AsyncMock(side_effect=lambda _q, items, top_k: items[:top_k])

        await service.search(TEST_ORG, "query", top_k=5)

        rerank_items = service._reranker.rerank.call_args[0][1]
        assert rerank_items[0]["content"] == "core span"


class TestGracefulFallback:
    """Error handling: BM25 not ready, missing tables/columns."""

    async def test_undefined_table_returns_empty(self):
        service, *_ = _build_service()
        service._fts_search = AsyncMock(side_effect=asyncpg.UndefinedTableError("relation does not exist"))
        service._vector_search = AsyncMock(return_value=[])

        # The exception is raised from the concurrent tasks, then caught in search()
        # We need to mock at a higher level since the exception propagates from gather
        with patch.object(service, "_fts_search", side_effect=asyncpg.UndefinedTableError("no table")):
            with patch.object(service, "_vector_search", return_value=[]):
                with patch.object(service._embedding, "embed_query", return_value=[0.1]):
                    results, _usage = await service.search(TEST_ORG, "query")

        assert results == []

    async def test_undefined_column_returns_empty(self):
        service, *_ = _build_service()

        with patch.object(service, "_fts_search", side_effect=asyncpg.UndefinedColumnError("column missing")):
            with patch.object(service, "_vector_search", return_value=[]):
                with patch.object(service._embedding, "embed_query", return_value=[0.1]):
                    results, _usage = await service.search(TEST_ORG, "query")

        assert results == []

    async def test_bm25_index_not_ready_falls_back_to_vector_only(self):
        vector_rows = [
            _make_row(1, "vec result 1", "doc-1", 0.9),
            _make_row(2, "vec result 2", "doc-2", 0.8),
        ]

        service, *_ = _build_service()

        async def raise_bm25(*args, **kwargs):
            raise asyncpg.InternalServerError("bm25 index not found")

        with patch.object(service, "_fts_search", side_effect=raise_bm25):
            with patch.object(service, "_vector_search", return_value=vector_rows):
                with patch.object(service._embedding, "embed_query", return_value=[0.1]):
                    results, _usage = await service.search(TEST_ORG, "query")

        assert len(results) == 2
        assert results[0]["content"] == "vec result 1"
        # Fallback returns raw vector similarity scores
        assert results[0]["score"] == pytest.approx(0.9)
        assert results[1]["score"] == pytest.approx(0.8)

    async def test_non_bm25_exception_propagates(self):
        service, *_ = _build_service()

        with patch.object(service, "_fts_search", side_effect=RuntimeError("unexpected db error")):
            with patch.object(service, "_vector_search", return_value=[]):
                with patch.object(service._embedding, "embed_query", return_value=[0.1]):
                    with pytest.raises(RuntimeError, match="unexpected db error"):
                        await service.search(TEST_ORG, "query")


class TestDataCorruptionRecovery:
    """DataCorruptedError triggers vector-only fallback and BM25 rebuild."""

    async def test_data_corrupted_error_falls_back_to_vector_only(self):
        vector_rows = [_make_row(1, "vec result", "doc-1", 0.9)]
        service, *_ = _build_service()

        with patch.object(service, "_fts_search", side_effect=asyncpg.DataCorruptedError("could not read block 0")):
            with patch.object(service, "_vector_search", return_value=vector_rows):
                with patch.object(service._embedding, "embed_query", return_value=[0.1]):
                    with patch.object(service, "_rebuild_bm25_index", new_callable=AsyncMock):
                        results, _usage = await service.search(TEST_ORG, "query")

        assert len(results) == 1
        assert results[0]["content"] == "vec result"
        assert results[0]["score"] == pytest.approx(0.9)

    async def test_data_corrupted_error_triggers_rebuild(self):
        import asyncio as _asyncio

        service, *_ = _build_service()

        with patch.object(service, "_fts_search", side_effect=asyncpg.DataCorruptedError("could not read block 0")):
            with patch.object(service, "_vector_search", return_value=[]):
                with patch.object(service._embedding, "embed_query", return_value=[0.1]):
                    with patch.object(service, "_rebuild_bm25_index", new_callable=AsyncMock) as mock_rebuild:
                        await service.search(TEST_ORG, "query")
                        await _asyncio.sleep(0)

        mock_rebuild.assert_awaited_once()

    async def test_fts_data_corrupted_error_returns_empty(self):
        """DataCorruptedError in _fts_search returns empty list."""
        from app.services.search_service import RagSearchService

        pool = MagicMock()
        embed = MagicMock()
        service = RagSearchService(pool, embed)

        mock_conn = AsyncMock()
        mock_conn.fetch = AsyncMock(side_effect=asyncpg.DataCorruptedError("could not read block 0 in file"))

        with patch("app.services.search_service.acquire_with_retry") as mock_acq:
            mock_acq.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_acq.return_value.__aexit__ = AsyncMock(return_value=False)

            results = await service._fts_search("query", TEST_ORG, None, 10)

        assert results == []

    async def test_rebuild_bm25_index_calls_reindex(self):
        """_rebuild_bm25_index executes REINDEX on the BM25 index."""
        from app.services.search_service import RagSearchService

        pool = MagicMock()
        embed = MagicMock()
        service = RagSearchService(pool, embed)

        mock_conn = AsyncMock()
        mock_conn.execute = AsyncMock()

        with patch("app.services.search_service.acquire_with_retry") as mock_acq:
            mock_acq.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_acq.return_value.__aexit__ = AsyncMock(return_value=False)

            await service._rebuild_bm25_index()

        mock_conn.execute.assert_awaited_once()
        sql = mock_conn.execute.call_args[0][0]
        assert "REINDEX" in sql
        assert "idx_pk_chunks_bm25" in sql

    async def test_rebuild_bm25_index_handles_errors(self):
        """_rebuild_bm25_index logs but does not raise on failure."""
        from app.services.search_service import RagSearchService

        pool = MagicMock()
        embed = MagicMock()
        service = RagSearchService(pool, embed)

        mock_conn = AsyncMock()
        mock_conn.execute = AsyncMock(side_effect=RuntimeError("lock timeout"))

        with patch("app.services.search_service.acquire_with_retry") as mock_acq:
            mock_acq.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_acq.return_value.__aexit__ = AsyncMock(return_value=False)

            await service._rebuild_bm25_index()


class TestFtsSearch:
    """Unit tests for the _fts_search private method."""

    async def test_fts_bm25_failure_returns_empty(self):
        """When BM25 search fails with a bm25-related error, return empty list."""
        from app.services.search_service import RagSearchService

        pool = MagicMock()
        embed = MagicMock()
        service = RagSearchService(pool, embed)

        mock_conn = AsyncMock()
        mock_conn.fetch = AsyncMock(side_effect=asyncpg.InternalServerError("bm25 index corrupted"))

        with patch("app.services.search_service.acquire_with_retry") as mock_acq:
            mock_acq.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_acq.return_value.__aexit__ = AsyncMock(return_value=False)

            results = await service._fts_search("query", TEST_ORG, None, 10)

        assert results == []

    async def test_fts_internal_server_error_returns_empty(self):
        """Any InternalServerError from _fts_search returns empty (e.g. ParadeDB unsupported query)."""
        from app.services.search_service import RagSearchService

        pool = MagicMock()
        embed = MagicMock()
        service = RagSearchService(pool, embed)

        mock_conn = AsyncMock()
        mock_conn.fetch = AsyncMock(side_effect=asyncpg.InternalServerError("Unsupported query shape"))

        with patch("app.services.search_service.acquire_with_retry") as mock_acq:
            mock_acq.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_acq.return_value.__aexit__ = AsyncMock(return_value=False)

            results = await service._fts_search("query", TEST_ORG, ["doc-1"], 10)

        assert results == []

    async def test_fts_non_db_error_propagates(self):
        """Non-database errors from _fts_search should propagate."""
        from app.services.search_service import RagSearchService

        pool = MagicMock()
        embed = MagicMock()
        service = RagSearchService(pool, embed)

        mock_conn = AsyncMock()
        mock_conn.fetch = AsyncMock(side_effect=RuntimeError("connection refused"))

        with patch("app.services.search_service.acquire_with_retry") as mock_acq:
            mock_acq.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_acq.return_value.__aexit__ = AsyncMock(return_value=False)

            with pytest.raises(RuntimeError, match="connection refused"):
                await service._fts_search("query", TEST_ORG, None, 10)


class TestApplyRecencyBoost:
    """Unit tests for _apply_recency_boost."""

    def test_recent_document_scores_higher_than_old(self):
        from app.services.search_service import _apply_recency_boost

        now = datetime.now(timezone.utc)
        results = [
            {"rrf_score": 1.0, "source_modified_at": now - timedelta(days=700), "created_at": None},
            {"rrf_score": 1.0, "source_modified_at": now - timedelta(days=1), "created_at": None},
        ]

        _apply_recency_boost(results, decay_base=0.85, max_age_days=730)

        assert results[0]["source_modified_at"] > results[1]["source_modified_at"]
        assert results[0]["rrf_score"] > results[1]["rrf_score"]

    def test_none_timestamps_get_conservative_boost(self):
        from app.services.search_service import _apply_recency_boost

        now = datetime.now(timezone.utc)
        results = [
            {"rrf_score": 1.0, "source_modified_at": None, "created_at": None},
            {"rrf_score": 1.0, "source_modified_at": now - timedelta(days=1), "created_at": None},
        ]

        _apply_recency_boost(results, decay_base=0.85, max_age_days=730)

        # After sorting, the recent doc (highest boost) is first
        # None-timestamp doc gets decay_base (0.85), recent doc gets ~1.0
        assert results[0]["rrf_score"] > results[1]["rrf_score"]
        assert results[1]["rrf_score"] == pytest.approx(0.85)

    def test_falls_back_to_created_at(self):
        from app.services.search_service import _apply_recency_boost

        now = datetime.now(timezone.utc)
        results = [
            {"rrf_score": 1.0, "source_modified_at": None, "created_at": now - timedelta(days=1)},
            {"rrf_score": 1.0, "source_modified_at": None, "created_at": None},
        ]

        _apply_recency_boost(results, decay_base=0.85, max_age_days=730)

        # Doc with created_at fallback should score higher than one with no date
        assert results[0]["rrf_score"] > results[1]["rrf_score"]

    def test_very_old_document_gets_decay_base(self):
        from app.services.search_service import _apply_recency_boost

        now = datetime.now(timezone.utc)
        results = [
            {"rrf_score": 1.0, "source_modified_at": now - timedelta(days=2000), "created_at": None},
            {"rrf_score": 1.0, "source_modified_at": now - timedelta(days=1), "created_at": None},
        ]

        _apply_recency_boost(results, decay_base=0.85, max_age_days=730)

        # After sorting, recent doc is first with boost ~1.0
        # Very old doc (age > max_age_days) gets clamped to decay_base
        assert results[0]["rrf_score"] == pytest.approx(1.0, abs=0.01)
        assert results[1]["rrf_score"] == pytest.approx(0.85, abs=0.01)

    def test_top_score_not_renormalized(self):
        from app.services.search_service import _apply_recency_boost

        now = datetime.now(timezone.utc)
        results = [
            {"rrf_score": 0.5, "source_modified_at": now - timedelta(days=10), "created_at": None},
            {"rrf_score": 0.3, "source_modified_at": now - timedelta(days=100), "created_at": None},
        ]

        _apply_recency_boost(results, decay_base=0.85, max_age_days=730)

        # Scores are boosted in place without re-normalization, so top score < 1.0
        assert results[0]["rrf_score"] < 1.0
        assert results[0]["rrf_score"] > results[1]["rrf_score"]

    def test_empty_results_no_error(self):
        from app.services.search_service import _apply_recency_boost

        results: list[dict[str, Any]] = []
        _apply_recency_boost(results, decay_base=0.85, max_age_days=730)

        assert results == []

    def test_results_sorted_descending(self):
        from app.services.search_service import _apply_recency_boost

        now = datetime.now(timezone.utc)
        results = [
            {"rrf_score": 0.8, "source_modified_at": now - timedelta(days=600), "created_at": None},
            {"rrf_score": 0.5, "source_modified_at": now - timedelta(days=1), "created_at": None},
            {"rrf_score": 0.9, "source_modified_at": now - timedelta(days=300), "created_at": None},
        ]

        _apply_recency_boost(results, decay_base=0.85, max_age_days=730)

        scores = [r["rrf_score"] for r in results]
        assert scores == sorted(scores, reverse=True)


class TestRecencyBoostIntegration:
    """Recency boost applied during search() when enabled."""

    async def test_recency_boost_applied_when_enabled(self):
        now = datetime.now(timezone.utc)
        fts_rows = [
            {
                **_make_row(1, "Old doc", "doc-1", 5.0),
                "source_modified_at": now - timedelta(days=700),
                "created_at": now - timedelta(days=700),
            },
        ]
        vector_rows = [
            {
                **_make_row(2, "New doc", "doc-2", 0.9),
                "source_modified_at": now - timedelta(days=1),
                "created_at": now - timedelta(days=1),
            },
        ]

        service, *_ = _build_service()
        service._fts_search = AsyncMock(return_value=fts_rows)
        service._vector_search = AsyncMock(return_value=vector_rows)

        with patch("app.services.search_service.settings") as mock_settings:
            mock_settings.recency_boost_enabled = True
            mock_settings.recency_decay_base = 0.85
            mock_settings.recency_max_age_days = 730
            mock_settings.semantic_cache_enabled = False
            mock_settings.vector_quality_threshold = 0
            mock_settings.reranking_enabled = False

            results, _usage = await service.search(TEST_ORG, "query")

        assert len(results) == 2
        new_doc = next(r for r in results if r["file_id"] == "doc-2")
        old_doc = next(r for r in results if r["file_id"] == "doc-1")
        assert new_doc["score"] >= old_doc["score"]

    async def test_recency_boost_skipped_when_disabled(self):
        fts_rows = [_make_row(1, "Result A", "doc-1", 5.0)]
        vector_rows = [_make_row(2, "Result B", "doc-2", 0.9)]

        service, *_ = _build_service()
        service._fts_search = AsyncMock(return_value=fts_rows)
        service._vector_search = AsyncMock(return_value=vector_rows)

        with patch("app.services.search_service.settings") as mock_settings:
            mock_settings.recency_boost_enabled = False
            mock_settings.semantic_cache_enabled = False
            mock_settings.vector_quality_threshold = 0
            mock_settings.reranking_enabled = False

            with patch("app.services.search_service._apply_recency_boost") as mock_boost:
                results, _usage = await service.search(TEST_ORG, "query")

                mock_boost.assert_not_called()

        assert len(results) == 2

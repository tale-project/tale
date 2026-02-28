"""Tests for RagSearchService hybrid search.

Covers:
- Hybrid search (FTS + vector) with RRF fusion
- Tenant filtering (team_id, user_id, both, neither)
- Graceful fallback when BM25 index not ready
- UndefinedTableError / UndefinedColumnError handling
- Empty results from both search channels
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import asyncpg
import pytest

pytestmark = pytest.mark.asyncio


def _make_row(
    row_id: int, chunk_content: str, document_id: str, score: float = 1.0, chunk_index: int = 0
) -> dict[str, Any]:
    return {
        "id": row_id,
        "chunk_content": chunk_content,
        "chunk_index": chunk_index,
        "document_id": document_id,
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
    embedding_service.embed_query = AsyncMock(return_value=embed_return or [0.1, 0.2, 0.3])

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

            results = await service.search("test query", team_ids=["team-1"])

        assert len(results) > 0
        for r in results:
            assert "content" in r
            assert "score" in r
            assert "document_id" in r

    async def test_returns_empty_when_both_channels_empty(self):
        service, *_ = _build_service(fts_rows=[], vector_rows=[])

        service._fts_search = AsyncMock(return_value=[])
        service._vector_search = AsyncMock(return_value=[])

        results = await service.search("nothing here")

        assert results == []

    async def test_fts_only_results(self):
        fts_rows = [
            _make_row(1, "Only FTS hit", "doc-1", 3.0),
            _make_row(2, "Another FTS hit", "doc-2", 2.0),
        ]
        service, *_ = _build_service(fts_rows=fts_rows, vector_rows=[])

        service._fts_search = AsyncMock(return_value=fts_rows)
        service._vector_search = AsyncMock(return_value=[])

        results = await service.search("fts query")

        assert len(results) == 2
        assert results[0]["content"] == "Only FTS hit"

    async def test_vector_only_results(self):
        vector_rows = [_make_row(10, "Vector hit", "doc-v", 0.95)]
        service, *_ = _build_service(fts_rows=[], vector_rows=vector_rows)

        service._fts_search = AsyncMock(return_value=[])
        service._vector_search = AsyncMock(return_value=vector_rows)

        results = await service.search("vector query")

        assert len(results) == 1
        assert results[0]["content"] == "Vector hit"

    async def test_top_k_limits_results(self):
        fts_rows = [_make_row(i, f"chunk-{i}", "doc-1") for i in range(20)]
        vector_rows = [_make_row(100 + i, f"vchunk-{i}", "doc-2") for i in range(20)]

        service, *_ = _build_service()
        service._fts_search = AsyncMock(return_value=fts_rows)
        service._vector_search = AsyncMock(return_value=vector_rows)

        results = await service.search("query", top_k=5)

        assert len(results) <= 5

    async def test_embedding_service_called_with_query(self):
        service, _, embed_svc, *_ = _build_service()
        service._fts_search = AsyncMock(return_value=[])
        service._vector_search = AsyncMock(return_value=[])

        await service.search("my search query")

        embed_svc.embed_query.assert_awaited_once_with("my search query")


class TestTenantFiltering:
    """Tenant clause construction and parameter passing."""

    def test_build_tenant_clause_team_ids_only(self):
        from app.services.search_service import RagSearchService

        pool = MagicMock()
        embed = MagicMock()
        service = RagSearchService(pool, embed)

        clause, params = service._build_tenant_clause(["team-a", "team-b"], None, 1)

        assert "team_id = ANY($2)" in clause
        assert params == [["team-a", "team-b"]]

    def test_build_tenant_clause_user_id_only(self):
        from app.services.search_service import RagSearchService

        pool = MagicMock()
        embed = MagicMock()
        service = RagSearchService(pool, embed)

        clause, params = service._build_tenant_clause(None, "user-1", 1)

        assert "user_id = $2" in clause
        assert params == ["user-1"]

    def test_build_tenant_clause_both(self):
        from app.services.search_service import RagSearchService

        pool = MagicMock()
        embed = MagicMock()
        service = RagSearchService(pool, embed)

        clause, params = service._build_tenant_clause(["team-x"], "user-y", 1)

        assert "team_id = ANY($2)" in clause
        assert "user_id = $3" in clause
        assert "OR" in clause
        assert params == [["team-x"], "user-y"]

    def test_build_tenant_clause_neither(self):
        from app.services.search_service import RagSearchService

        pool = MagicMock()
        embed = MagicMock()
        service = RagSearchService(pool, embed)

        clause, params = service._build_tenant_clause(None, None, 1)

        assert clause == ""
        assert params == []

    def test_build_tenant_clause_respects_param_offset(self):
        from app.services.search_service import RagSearchService

        pool = MagicMock()
        embed = MagicMock()
        service = RagSearchService(pool, embed)

        clause, params = service._build_tenant_clause(["team-a"], "user-b", 3)

        assert "$4" in clause
        assert "$5" in clause

    async def test_search_passes_team_ids_to_fts_and_vector(self):
        service, *_ = _build_service()
        service._fts_search = AsyncMock(return_value=[])
        service._vector_search = AsyncMock(return_value=[])

        await service.search("query", team_ids=["t1", "t2"], user_id="u1")

        service._fts_search.assert_awaited_once()
        fts_args = service._fts_search.call_args
        assert fts_args[0][1] == ["t1", "t2"]
        assert fts_args[0][2] == "u1"

        service._vector_search.assert_awaited_once()
        vec_args = service._vector_search.call_args
        assert vec_args[0][1] == ["t1", "t2"]
        assert vec_args[0][2] == "u1"


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
                    results = await service.search("query")

        assert results == []

    async def test_undefined_column_returns_empty(self):
        service, *_ = _build_service()

        with patch.object(service, "_fts_search", side_effect=asyncpg.UndefinedColumnError("column missing")):
            with patch.object(service, "_vector_search", return_value=[]):
                with patch.object(service._embedding, "embed_query", return_value=[0.1]):
                    results = await service.search("query")

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
                    results = await service.search("query")

        assert len(results) == 2
        assert results[0]["content"] == "vec result 1"
        # Fallback uses 1/(i+1) scoring
        assert results[0]["score"] == pytest.approx(1.0)
        assert results[1]["score"] == pytest.approx(0.5)

    async def test_non_bm25_exception_propagates(self):
        service, *_ = _build_service()

        with patch.object(service, "_fts_search", side_effect=RuntimeError("unexpected db error")):
            with patch.object(service, "_vector_search", return_value=[]):
                with patch.object(service._embedding, "embed_query", return_value=[0.1]):
                    with pytest.raises(RuntimeError, match="unexpected db error"):
                        await service.search("query")


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

            results = await service._fts_search("query", None, None, 10)

        assert results == []

    async def test_fts_non_bm25_error_propagates(self):
        """Non-BM25 errors from _fts_search should propagate."""
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
                await service._fts_search("query", None, None, 10)

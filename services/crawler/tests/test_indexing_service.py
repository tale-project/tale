import hashlib
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import stamina

from app.services.chunking_service import ContentChunk
from app.services.indexing_service import IndexingService
from app.utils.paragraph_dedup import paragraph_hash


@pytest.fixture(autouse=True)
def _fast_stamina_retries():
    """Keep retries but disable backoff delays for speed."""
    with stamina.set_testing(True, attempts=1):
        yield


def _sha256(content: str) -> str:
    return hashlib.sha256(content.encode()).hexdigest()


@pytest.fixture
def mock_conn():
    conn = AsyncMock()
    conn.fetchval = AsyncMock(return_value=1)
    conn.fetch = AsyncMock(return_value=[])
    conn.fetchrow = AsyncMock(return_value=None)
    conn.execute = AsyncMock(return_value="DELETE 0")
    conn.executemany = AsyncMock()
    conn.transaction = MagicMock(return_value=AsyncMock(__aenter__=AsyncMock(), __aexit__=AsyncMock()))
    return conn


@pytest.fixture
def mock_pool(mock_conn):
    pool = AsyncMock()
    pool.acquire = AsyncMock(return_value=mock_conn)
    pool.release = AsyncMock()
    return pool


@pytest.fixture
def mock_embedding():
    service = AsyncMock()
    service.embed_texts = AsyncMock(return_value=[[0.1, 0.2], [0.3, 0.4]])
    return service


@pytest.fixture
def indexing_service(mock_pool, mock_embedding):
    return IndexingService(mock_pool, mock_embedding)


class TestIndexPage:
    async def test_skips_when_both_hashes_match(self, mock_conn, indexing_service):
        content = "some page content"
        content_hash = _sha256(content)
        filtered_hash = _sha256(content)

        mock_conn.fetchval = AsyncMock(return_value=1)
        mock_conn.fetchrow = AsyncMock(return_value={"content_hash": content_hash, "filtering_hash": filtered_hash})

        result = await indexing_service.index_page("example.com", "https://example.com/page", "Title", content)

        assert result["status"] == "skipped"
        assert result["chunks_indexed"] == 0

    async def test_reindexes_when_filtering_hash_differs(self, mock_conn, indexing_service, mock_embedding):
        content = "some page content"
        content_hash = _sha256(content)

        mock_conn.fetchval = AsyncMock(return_value=1)
        mock_conn.fetchrow = AsyncMock(
            return_value={"content_hash": content_hash, "filtering_hash": "old_filtering_hash"}
        )
        mock_embedding.embed_texts = AsyncMock(return_value=[[0.1, 0.2]])

        with patch("app.services.indexing_service.chunk_content") as mock_chunk:
            mock_chunk.return_value = [ContentChunk(content="chunk", index=0)]
            result = await indexing_service.index_page("example.com", "https://example.com/page", "Title", content)

        assert result["status"] == "indexed"

    async def test_reindexes_when_no_existing_record(self, mock_conn, indexing_service, mock_embedding):
        mock_conn.fetchval = AsyncMock(return_value=1)
        mock_conn.fetchrow = AsyncMock(return_value=None)
        mock_embedding.embed_texts = AsyncMock(return_value=[[0.1, 0.2]])

        with patch("app.services.indexing_service.chunk_content") as mock_chunk:
            mock_chunk.return_value = [ContentChunk(content="chunk", index=0)]
            result = await indexing_service.index_page("example.com", "https://example.com/page", "Title", "content")

        assert result["status"] == "indexed"

    @patch("app.services.indexing_service.chunk_content", return_value=[])
    async def test_returns_empty_when_no_chunks(self, mock_chunk, indexing_service, mock_conn):
        mock_conn.fetchval = AsyncMock(return_value=1)
        mock_conn.fetchrow = AsyncMock(return_value=None)

        result = await indexing_service.index_page("example.com", "https://example.com/page", "Title", "content")

        assert result["status"] == "empty"
        assert result["chunks_indexed"] == 0

    @patch("app.services.indexing_service.chunk_content")
    async def test_returns_error_when_embedding_fails(self, mock_chunk, indexing_service, mock_conn, mock_embedding):
        mock_chunk.return_value = [ContentChunk(content="chunk text", index=0)]
        mock_embedding.embed_texts = AsyncMock(side_effect=RuntimeError("API down"))
        mock_conn.fetchval = AsyncMock(return_value=1)
        mock_conn.fetchrow = AsyncMock(return_value=None)

        result = await indexing_service.index_page("example.com", "https://example.com/page", "Title", "content")

        assert result["status"] == "error"
        assert result["error"] == "embedding_failed"
        assert result["chunks_indexed"] == 0

    @patch("app.services.indexing_service.chunk_content")
    async def test_indexes_successfully(self, mock_chunk, indexing_service, mock_conn, mock_embedding):
        chunks = [ContentChunk(content="chunk one", index=0), ContentChunk(content="chunk two", index=1)]
        mock_chunk.return_value = chunks
        mock_embedding.embed_texts = AsyncMock(return_value=[[0.1, 0.2], [0.3, 0.4]])
        mock_conn.fetchval = AsyncMock(return_value=1)
        mock_conn.fetchrow = AsyncMock(return_value=None)

        result = await indexing_service.index_page("example.com", "https://example.com/page", "Title", "content")

        assert result["status"] == "indexed"
        assert result["chunks_indexed"] == 2
        assert result["url"] == "https://example.com/page"

    @patch("app.services.indexing_service.chunk_content")
    async def test_deletes_old_chunks_before_inserting(self, mock_chunk, indexing_service, mock_conn, mock_embedding):
        chunks = [ContentChunk(content="chunk", index=0)]
        mock_chunk.return_value = chunks
        mock_embedding.embed_texts = AsyncMock(return_value=[[0.1, 0.2]])
        mock_conn.fetchval = AsyncMock(return_value=1)
        mock_conn.fetchrow = AsyncMock(return_value=None)

        await indexing_service.index_page("example.com", "https://example.com/page", "Title", "content")

        calls = [str(c) for c in mock_conn.execute.call_args_list]
        delete_chunk_call = next(c for c in calls if "DELETE" in c and "chunks" in c.lower())
        assert "https://example.com/page" in delete_chunk_call


class TestParagraphHashTracking:
    async def test_records_paragraph_hashes(self, mock_conn, indexing_service, mock_embedding):
        content = "Paragraph one\n\nParagraph two"
        mock_conn.fetchval = AsyncMock(return_value=1)
        mock_conn.fetchrow = AsyncMock(return_value=None)
        mock_embedding.embed_texts = AsyncMock(return_value=[[0.1, 0.2]])

        with patch("app.services.indexing_service.chunk_content") as mock_chunk:
            mock_chunk.return_value = [ContentChunk(content="chunk", index=0)]
            await indexing_service.index_page("example.com", "https://example.com/page", "Title", content)

        executemany_calls = mock_conn.executemany.call_args_list
        hash_insert_call = next(c for c in executemany_calls if "page_paragraph_hashes" in str(c))
        inserted_rows = hash_insert_call[0][1]
        assert len(inserted_rows) == 2
        assert inserted_rows[0][0] == "example.com"
        assert inserted_rows[0][1] == "https://example.com/page"

    async def test_deletes_old_paragraph_hashes(self, mock_conn, indexing_service, mock_embedding):
        mock_conn.fetchval = AsyncMock(return_value=1)
        mock_conn.fetchrow = AsyncMock(return_value=None)
        mock_embedding.embed_texts = AsyncMock(return_value=[[0.1, 0.2]])

        with patch("app.services.indexing_service.chunk_content") as mock_chunk:
            mock_chunk.return_value = [ContentChunk(content="chunk", index=0)]
            await indexing_service.index_page("example.com", "https://example.com/page", "Title", "content")

        calls = [str(c) for c in mock_conn.execute.call_args_list]
        delete_hash_call = next(c for c in calls if "page_paragraph_hashes" in c)
        assert "example.com" in delete_hash_call
        assert "https://example.com/page" in delete_hash_call

    async def test_paragraph_hashes_recorded_even_on_embedding_failure(
        self, mock_conn, indexing_service, mock_embedding
    ):
        mock_conn.fetchval = AsyncMock(return_value=1)
        mock_conn.fetchrow = AsyncMock(return_value=None)
        mock_embedding.embed_texts = AsyncMock(side_effect=RuntimeError("API down"))

        with patch("app.services.indexing_service.chunk_content") as mock_chunk:
            mock_chunk.return_value = [ContentChunk(content="chunk", index=0)]
            result = await indexing_service.index_page("example.com", "https://example.com/page", "Title", "content")

        assert result["status"] == "error"
        executemany_calls = mock_conn.executemany.call_args_list
        hash_insert = [c for c in executemany_calls if "page_paragraph_hashes" in str(c)]
        assert len(hash_insert) == 1


class TestFrequencyFiltering:
    async def test_no_filtering_below_min_pages(self, mock_conn, indexing_service, mock_embedding):
        content = "Boilerplate text\n\nUnique content"
        mock_conn.fetchval = AsyncMock(return_value=3)
        mock_conn.fetchrow = AsyncMock(return_value=None)
        mock_embedding.embed_texts = AsyncMock(return_value=[[0.1, 0.2]])

        with patch("app.services.indexing_service.chunk_content") as mock_chunk:
            mock_chunk.return_value = [ContentChunk(content="chunk", index=0)]
            await indexing_service.index_page("example.com", "https://example.com/page", "Title", content)

        passed_content = mock_chunk.call_args[0][0]
        assert "Boilerplate text" in passed_content
        assert "Unique content" in passed_content

    async def test_filters_boilerplate_when_enough_pages(self, mock_conn, indexing_service, mock_embedding):
        content = "Boilerplate text\n\nUnique content"
        boilerplate_h = paragraph_hash("Boilerplate text")
        unique_h = paragraph_hash("Unique content")

        mock_conn.fetchval = AsyncMock(return_value=10)
        mock_conn.fetch = AsyncMock(
            return_value=[
                {"paragraph_hash": boilerplate_h, "url_count": 9},
                {"paragraph_hash": unique_h, "url_count": 1},
            ]
        )
        mock_conn.fetchrow = AsyncMock(return_value=None)
        mock_embedding.embed_texts = AsyncMock(return_value=[[0.1, 0.2]])

        with patch("app.services.indexing_service.chunk_content") as mock_chunk:
            mock_chunk.return_value = [ContentChunk(content="chunk", index=0)]
            await indexing_service.index_page("example.com", "https://example.com/page", "Title", content)

        passed_content = mock_chunk.call_args[0][0]
        assert "Boilerplate text" not in passed_content
        assert "Unique content" in passed_content

    @patch("app.services.indexing_service.chunk_content", return_value=[])
    async def test_empty_after_filtering_stores_filtering_hash(self, mock_chunk, mock_conn, indexing_service):
        content = "Only boilerplate"
        boilerplate_h = paragraph_hash("Only boilerplate")

        mock_conn.fetchval = AsyncMock(return_value=10)
        mock_conn.fetch = AsyncMock(return_value=[{"paragraph_hash": boilerplate_h, "url_count": 10}])
        mock_conn.fetchrow = AsyncMock(return_value=None)

        result = await indexing_service.index_page("example.com", "https://example.com/page", "Title", content)

        assert result["status"] == "empty"
        upsert_calls = [str(c) for c in mock_conn.execute.call_args_list if "website_urls" in str(c).lower()]
        assert any("filtering_hash" in c for c in upsert_calls)


class TestDeletePageChunks:
    async def test_returns_deleted_count(self, indexing_service, mock_conn):
        mock_conn.execute = AsyncMock(return_value="DELETE 5")

        count = await indexing_service.delete_page_chunks("https://example.com/page")

        assert count == 5

    async def test_returns_zero_when_no_rows_deleted(self, indexing_service, mock_conn):
        mock_conn.execute = AsyncMock(return_value="DELETE 0")

        count = await indexing_service.delete_page_chunks("https://example.com/page")

        assert count == 0

    async def test_returns_zero_when_result_is_empty(self, indexing_service, mock_conn):
        mock_conn.execute = AsyncMock(return_value="")

        count = await indexing_service.delete_page_chunks("https://example.com/page")

        assert count == 0


class TestIndexWebsite:
    async def test_aggregates_results_correctly(self, indexing_service, mock_conn):
        mock_conn.fetch = AsyncMock(
            side_effect=[
                [
                    {"url": "https://example.com/a", "title": "Page A", "content": "aaa"},
                    {"url": "https://example.com/b", "title": "Page B", "content": "bbb"},
                    {"url": "https://example.com/c", "title": "Page C", "content": "ccc"},
                ],
                [],
            ]
        )

        call_count = 0
        results = [
            {"url": "https://example.com/a", "status": "indexed", "chunks_indexed": 3},
            {"url": "https://example.com/b", "status": "skipped", "chunks_indexed": 0},
            {"url": "https://example.com/c", "status": "error", "chunks_indexed": 0, "error": "embedding_failed"},
        ]

        async def fake_index_page(domain, url, title, content):
            nonlocal call_count
            result = results[call_count]
            call_count += 1
            return result

        indexing_service.index_page = fake_index_page

        result = await indexing_service.index_website("example.com")

        assert result["domain"] == "example.com"
        assert result["pages_indexed"] == 1
        assert result["pages_skipped"] == 1
        assert result["pages_failed"] == 1
        assert result["total_chunks"] == 3

    async def test_returns_zeros_when_no_pages(self, indexing_service, mock_conn):
        mock_conn.fetch = AsyncMock(return_value=[])

        result = await indexing_service.index_website("empty.com")

        assert result["domain"] == "empty.com"
        assert result["pages_indexed"] == 0
        assert result["pages_skipped"] == 0
        assert result["pages_failed"] == 0
        assert result["total_chunks"] == 0

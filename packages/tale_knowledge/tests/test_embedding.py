"""Tests for embedding service."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from openai import APIConnectionError, RateLimitError

from tale_knowledge.embedding.service import (
    MAX_BATCH_SIZE,
    EmbeddingService,
)


def _make_service() -> EmbeddingService:
    return EmbeddingService(
        api_key="test-key",
        base_url="http://localhost:8080",
        model="text-embedding-3-small",
        dimensions=1536,
    )


class TestEmbeddingService:
    def test_dimensions_property(self):
        svc = _make_service()
        assert svc.dimensions == 1536

    @pytest.mark.asyncio
    async def test_embed_texts_empty(self):
        svc = _make_service()
        result = await svc.embed_texts([])
        assert result == []

    @pytest.mark.asyncio
    async def test_embed_texts_single_batch(self):
        svc = _make_service()

        mock_embedding = MagicMock()
        mock_embedding.embedding = [0.1, 0.2, 0.3]

        mock_response = MagicMock()
        mock_response.data = [mock_embedding, mock_embedding]

        svc._client = MagicMock()
        svc._client.embeddings = MagicMock()
        svc._client.embeddings.create = AsyncMock(return_value=mock_response)

        result = await svc.embed_texts(["hello", "world"])
        assert len(result) == 2
        assert result[0] == [0.1, 0.2, 0.3]

    @pytest.mark.asyncio
    async def test_embed_query(self):
        svc = _make_service()

        mock_embedding = MagicMock()
        mock_embedding.embedding = [0.5, 0.6]

        mock_response = MagicMock()
        mock_response.data = [mock_embedding]

        svc._client = MagicMock()
        svc._client.embeddings = MagicMock()
        svc._client.embeddings.create = AsyncMock(return_value=mock_response)

        result = await svc.embed_query("test query")
        assert result == [0.5, 0.6]

    @pytest.mark.asyncio
    async def test_embed_texts_multiple_batches(self):
        svc = _make_service()

        call_count = 0

        async def mock_create(**kwargs):
            nonlocal call_count
            call_count += 1
            batch = kwargs["input"]
            mock_response = MagicMock()
            mock_response.data = [
                MagicMock(embedding=[float(call_count)]) for _ in batch
            ]
            return mock_response

        svc._client = MagicMock()
        svc._client.embeddings = MagicMock()
        svc._client.embeddings.create = mock_create

        texts = [f"text-{i}" for i in range(MAX_BATCH_SIZE + 10)]
        result = await svc.embed_texts(texts)
        assert len(result) == MAX_BATCH_SIZE + 10
        assert call_count == 2

    @pytest.mark.asyncio
    async def test_retry_on_failure(self):
        svc = _make_service()

        mock_embedding = MagicMock()
        mock_embedding.embedding = [1.0]

        mock_response = MagicMock()
        mock_response.data = [mock_embedding]

        svc._client = MagicMock()
        svc._client.embeddings = MagicMock()
        svc._client.embeddings.create = AsyncMock(
            side_effect=[
                APIConnectionError(request=MagicMock()),
                mock_response,
            ]
        )

        with patch(
            "tale_knowledge.embedding.service.asyncio.sleep", new_callable=AsyncMock
        ):
            result = await svc.embed_texts(["test"])
            assert result == [[1.0]]

    @pytest.mark.asyncio
    async def test_non_retryable_error_propagates(self):
        svc = _make_service()

        svc._client = MagicMock()
        svc._client.embeddings = MagicMock()
        svc._client.embeddings.create = AsyncMock(side_effect=ValueError("bad input"))

        with pytest.raises(ValueError, match="bad input"):
            await svc.embed_texts(["test"])

    @pytest.mark.asyncio
    async def test_close(self):
        svc = _make_service()
        svc._client = MagicMock()
        svc._client.close = AsyncMock()
        await svc.close()
        svc._client.close.assert_awaited_once()

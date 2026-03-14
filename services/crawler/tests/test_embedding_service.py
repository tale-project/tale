from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from openai import APIConnectionError
from tale_knowledge.embedding import EmbeddingService

pytestmark = pytest.mark.asyncio


def make_embedding_response(embeddings: list[list[float]]):
    return SimpleNamespace(data=[SimpleNamespace(embedding=e) for e in embeddings])


def create_service(dimensions: int = 1536) -> EmbeddingService:
    service = EmbeddingService(
        api_key="test-key",
        base_url=None,
        model="test-model",
        dimensions=dimensions,
    )
    mock_client = MagicMock()
    mock_client.embeddings.create = AsyncMock()
    service._client = mock_client
    return service


class TestDimensionsProperty:
    def test_returns_configured_dimensions(self):
        service = create_service(dimensions=768)
        assert service.dimensions == 768

    def test_returns_default_dimensions(self):
        service = create_service()
        assert service.dimensions == 1536


class TestEmbedTexts:
    async def test_empty_texts_returns_empty_list(self):
        service = create_service()
        result = await service.embed_texts([])
        assert result == []
        service._client.embeddings.create.assert_not_called()

    async def test_single_text(self):
        service = create_service(dimensions=3)
        expected = [0.1, 0.2, 0.3]
        service._client.embeddings.create.return_value = make_embedding_response([expected])

        result = await service.embed_texts(["hello"])

        assert result == [expected]
        service._client.embeddings.create.assert_called_once_with(
            model="test-model",
            input=["hello"],
            dimensions=3,
        )

    async def test_multiple_texts_single_batch(self):
        service = create_service(dimensions=2)
        embeddings = [[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]]
        service._client.embeddings.create.return_value = make_embedding_response(embeddings)

        result = await service.embed_texts(["a", "b", "c"])

        assert result == embeddings
        service._client.embeddings.create.assert_called_once_with(
            model="test-model",
            input=["a", "b", "c"],
            dimensions=2,
        )

    async def test_batching_splits_large_input(self, monkeypatch):
        import tale_knowledge.embedding.service as module

        monkeypatch.setattr(module, "MAX_BATCH_SIZE", 2)

        service = create_service(dimensions=2)
        batch1_embeddings = [[0.1, 0.2], [0.3, 0.4]]
        batch2_embeddings = [[0.5, 0.6]]
        service._client.embeddings.create.side_effect = [
            make_embedding_response(batch1_embeddings),
            make_embedding_response(batch2_embeddings),
        ]

        result = await service.embed_texts(["a", "b", "c"])

        assert result == [[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]]
        assert service._client.embeddings.create.call_count == 2
        calls = service._client.embeddings.create.call_args_list
        assert calls[0].kwargs == {"model": "test-model", "input": ["a", "b"], "dimensions": 2}
        assert calls[1].kwargs == {"model": "test-model", "input": ["c"], "dimensions": 2}

    async def test_batching_exact_multiple(self, monkeypatch):
        import tale_knowledge.embedding.service as module

        monkeypatch.setattr(module, "MAX_BATCH_SIZE", 2)

        service = create_service(dimensions=1)
        service._client.embeddings.create.side_effect = [
            make_embedding_response([[1.0], [2.0]]),
            make_embedding_response([[3.0], [4.0]]),
        ]

        result = await service.embed_texts(["a", "b", "c", "d"])

        assert result == [[1.0], [2.0], [3.0], [4.0]]
        assert service._client.embeddings.create.call_count == 2


class TestEmbedQuery:
    async def test_returns_single_vector(self):
        service = create_service(dimensions=3)
        expected = [0.1, 0.2, 0.3]
        service._client.embeddings.create.return_value = make_embedding_response([expected])

        result = await service.embed_query("search term")

        assert result == expected
        service._client.embeddings.create.assert_called_once_with(
            model="test-model",
            input=["search term"],
            dimensions=3,
        )


class TestRetryBehavior:
    @patch("tale_knowledge.embedding.service.random.uniform", return_value=0)
    @patch("tale_knowledge.embedding.service.asyncio.sleep", new_callable=AsyncMock)
    async def test_retries_on_first_failure(self, mock_sleep, _mock_uniform):
        service = create_service(dimensions=2)
        expected = [[0.1, 0.2]]
        service._client.embeddings.create.side_effect = [
            APIConnectionError(request=MagicMock()),
            make_embedding_response(expected),
        ]

        result = await service.embed_texts(["hello"])

        assert result == expected
        assert service._client.embeddings.create.call_count == 2
        mock_sleep.assert_awaited_once_with(1.0)

    @patch("tale_knowledge.embedding.service.random.uniform", return_value=0)
    @patch("tale_knowledge.embedding.service.asyncio.sleep", new_callable=AsyncMock)
    async def test_raises_after_all_retries_exhausted(self, mock_sleep, _mock_uniform):
        service = create_service(dimensions=2)
        service._client.embeddings.create.side_effect = [
            APIConnectionError(request=MagicMock()),
            APIConnectionError(request=MagicMock()),
            APIConnectionError(request=MagicMock()),
        ]

        with pytest.raises(APIConnectionError):
            await service.embed_texts(["hello"])

        assert service._client.embeddings.create.call_count == 3
        assert mock_sleep.await_count == 2

    async def test_no_retry_on_success(self):
        service = create_service(dimensions=2)
        expected = [[0.1, 0.2]]
        service._client.embeddings.create.return_value = make_embedding_response(expected)

        result = await service.embed_texts(["hello"])

        assert result == expected
        assert service._client.embeddings.create.call_count == 1

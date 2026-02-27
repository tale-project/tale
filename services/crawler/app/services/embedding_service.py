"""
OpenAI-compatible embedding generation service.

Uses the async OpenAI client to generate embeddings via any OpenAI-compatible API.
"""

import asyncio

from loguru import logger
from openai import AsyncOpenAI

from app.config import settings

MAX_BATCH_SIZE = 2048
MAX_CONCURRENT_REQUESTS = 3
RETRY_DELAY_SECONDS = 1.0


class EmbeddingService:
    def __init__(self, api_key: str, base_url: str | None, model: str, dimensions: int):
        self._client = AsyncOpenAI(api_key=api_key, base_url=base_url)
        self._model = model
        self._dimensions = dimensions
        self._semaphore = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)

    @property
    def dimensions(self) -> int:
        return self._dimensions

    async def _embed_batch(self, batch: list[str]) -> list[list[float]]:
        async with self._semaphore:
            try:
                response = await self._client.embeddings.create(
                    model=self._model,
                    input=batch,
                    dimensions=self._dimensions,
                )
                return [item.embedding for item in response.data]
            except Exception:
                logger.warning(f"Embedding request failed, retrying in {RETRY_DELAY_SECONDS}s")
                await asyncio.sleep(RETRY_DELAY_SECONDS)
                response = await self._client.embeddings.create(
                    model=self._model,
                    input=batch,
                    dimensions=self._dimensions,
                )
                return [item.embedding for item in response.data]

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []

        all_embeddings: list[list[float]] = []
        for i in range(0, len(texts), MAX_BATCH_SIZE):
            batch = texts[i : i + MAX_BATCH_SIZE]
            batch_embeddings = await self._embed_batch(batch)
            all_embeddings.extend(batch_embeddings)

        return all_embeddings

    async def embed_query(self, query: str) -> list[float]:
        result = await self.embed_texts([query])
        return result[0]


_embedding_service: EmbeddingService | None = None


def get_embedding_service() -> EmbeddingService:
    global _embedding_service
    if _embedding_service is None:
        _embedding_service = EmbeddingService(
            api_key=settings.get_openai_api_key(),
            base_url=settings.get_openai_base_url(),
            model=settings.get_embedding_model(),
            dimensions=settings.embedding_dimensions,
        )
        logger.info(f"Embedding service: model={settings.get_embedding_model()}, dims={settings.embedding_dimensions}")
    return _embedding_service

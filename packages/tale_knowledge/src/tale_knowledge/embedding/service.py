"""OpenAI-compatible embedding generation service.

Constructor-injected configuration — no global state or settings imports.
Each service creates its own EmbeddingService instance with its own config.
"""

import asyncio

from loguru import logger
from openai import AsyncOpenAI

MAX_BATCH_SIZE = 2048
MAX_CONCURRENT_REQUESTS = 3
MAX_RETRIES = 3
RETRY_BASE_DELAY = 1.0


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
            for attempt in range(MAX_RETRIES):
                try:
                    response = await self._client.embeddings.create(
                        model=self._model,
                        input=batch,
                        dimensions=self._dimensions,
                    )
                    return [item.embedding for item in response.data]
                except Exception:
                    if attempt == MAX_RETRIES - 1:
                        raise
                    delay = RETRY_BASE_DELAY * (2**attempt)
                    logger.warning(
                        f"Embedding request failed (attempt {attempt + 1}/{MAX_RETRIES}), "
                        f"retrying in {delay}s"
                    )
                    await asyncio.sleep(delay)
            raise RuntimeError("unreachable")

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

"""OpenAI-compatible embedding generation service.

Constructor-injected configuration — no global state or settings imports.
Each service creates its own EmbeddingService instance with its own config.
"""

import asyncio
import random

from loguru import logger
from openai import (
    APIConnectionError,
    APITimeoutError,
    AsyncOpenAI,
    InternalServerError,
    RateLimitError,
)

MAX_BATCH_SIZE = 256
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

    def _zero_vector(self) -> list[float]:
        return [0.0] * self._dimensions

    async def _embed_batch(self, batch: list[str]) -> list[list[float]]:
        valid = [(i, text) for i, text in enumerate(batch) if text.strip()]
        if not valid:
            return [self._zero_vector() for _ in batch]

        valid_indices, valid_texts = zip(*valid)

        async with self._semaphore:
            for attempt in range(MAX_RETRIES):
                try:
                    response = await self._client.embeddings.create(
                        model=self._model,
                        input=list(valid_texts),
                        dimensions=self._dimensions,
                    )
                    if not response.data:
                        raise ValueError("No embedding data received")
                    embeddings = [item.embedding for item in response.data]
                    break
                except (
                    RateLimitError,
                    APITimeoutError,
                    APIConnectionError,
                    InternalServerError,
                ):
                    if attempt == MAX_RETRIES - 1:
                        raise
                    delay = RETRY_BASE_DELAY * (2**attempt) + random.uniform(0, 0.5)
                    logger.warning(
                        "Embedding request failed (attempt {}/{}), retrying in {:.2f}s",
                        attempt + 1,
                        MAX_RETRIES,
                        delay,
                    )
                    await asyncio.sleep(delay)
                except ValueError:
                    logger.warning(
                        "Embedding returned empty data for batch of {} texts, filling with zero vectors",
                        len(valid_texts),
                    )
                    return [self._zero_vector() for _ in batch]

        results: list[list[float]] = [self._zero_vector() for _ in batch]
        for idx, emb in zip(valid_indices, embeddings):
            results[idx] = emb
        return results

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        batches = [
            texts[i : i + MAX_BATCH_SIZE] for i in range(0, len(texts), MAX_BATCH_SIZE)
        ]
        results = await asyncio.gather(*[self._embed_batch(batch) for batch in batches])
        return [emb for batch_result in results for emb in batch_result]

    async def embed_query(self, query: str) -> list[float]:
        result = await self.embed_texts([query])
        return result[0]

    async def close(self):
        await self._client.close()

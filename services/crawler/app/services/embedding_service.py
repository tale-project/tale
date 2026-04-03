"""
OpenAI-compatible embedding generation service.

Crawler-specific factory for creating EmbeddingService instances.
"""

from loguru import logger
from tale_knowledge.embedding import EmbeddingService

from app.config import settings

_embedding_service: EmbeddingService | None = None


def get_embedding_service() -> EmbeddingService:
    global _embedding_service
    if _embedding_service is None:
        base_url, api_key, model, dims = settings.get_embedding_config()
        _embedding_service = EmbeddingService(
            api_key=api_key,
            base_url=base_url,
            model=model,
            dimensions=dims,
        )
        logger.info(f"Embedding service: model={model}, dims={dims}")
    return _embedding_service

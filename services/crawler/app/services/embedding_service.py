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
        _embedding_service = EmbeddingService(
            api_key=settings.get_openai_api_key(),
            base_url=settings.get_openai_base_url(),
            model=settings.get_embedding_model(),
            dimensions=settings.get_embedding_dimensions(),
        )
        logger.info(
            f"Embedding service: model={settings.get_embedding_model()}, dims={settings.get_embedding_dimensions()}"
        )
    return _embedding_service

"""
OpenAI-compatible embedding generation service.

Re-exports EmbeddingService from the shared tale_knowledge package
and provides a crawler-specific factory for creating instances.
"""

from loguru import logger

from app.config import settings

from tale_knowledge.embedding import EmbeddingService  # noqa: F401 — re-exported

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

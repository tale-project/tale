"""
OpenAI-compatible embedding generation service.

Crawler-specific factory with TTL-based config refresh.
When provider config files change (e.g. API key rotation), the client
is automatically rebuilt on the next access after the TTL expires.
"""

import asyncio
import time

from loguru import logger
from tale_knowledge.embedding import EmbeddingService

from app.config import settings

_embedding_service: EmbeddingService | None = None
_embedding_config: tuple | None = None
_last_config_check: float = 0
_CONFIG_CHECK_INTERVAL = 15  # seconds


async def _close_old(service: EmbeddingService) -> None:
    try:
        await service.close()
    except Exception:
        logger.warning("Failed to close old embedding service")


def get_embedding_service() -> EmbeddingService:
    global _embedding_service, _embedding_config, _last_config_check

    now = time.monotonic()
    if _embedding_service is not None and (now - _last_config_check) < _CONFIG_CHECK_INTERVAL:
        return _embedding_service

    _last_config_check = now
    config = settings.get_embedding_config()  # (base_url, api_key, model, dims)

    if config == _embedding_config:
        return _embedding_service  # type: ignore[return-value]

    base_url, api_key, model, dims = config

    # Never downgrade to empty key
    if not api_key and _embedding_config is not None:
        logger.warning("Skipping embedding reload: new config has empty API key")
        return _embedding_service  # type: ignore[return-value]

    # Refuse dimension change (would corrupt vector index)
    if _embedding_config is not None and dims != _embedding_config[3]:
        logger.error(
            "Embedding dimensions changed ({} -> {}). Restart required to re-index.",
            _embedding_config[3],
            dims,
        )
        return _embedding_service  # type: ignore[return-value]

    old = _embedding_service
    _embedding_service = EmbeddingService(
        api_key=api_key,
        base_url=base_url,
        model=model,
        dimensions=dims,
    )
    _embedding_config = config

    if old is not None:
        logger.info("Embedding service rebuilt: model={}", model)
        try:
            asyncio.get_running_loop().create_task(_close_old(old))
        except RuntimeError:
            pass
    else:
        logger.info("Embedding service created: model={}, dims={}", model, dims)

    return _embedding_service

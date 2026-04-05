"""
OpenAI-compatible embedding generation service.

Crawler-specific factory with TTL-based config refresh.
When provider config files change (e.g. API key rotation), the client
is automatically rebuilt on the next access after the TTL expires.
"""

import asyncio
import contextlib
import time

from loguru import logger
from tale_knowledge.embedding import EmbeddingService

from app.config import settings

_embedding_service: EmbeddingService | None = None
_embedding_config: tuple | None = None
_last_config_check: float = 0
_CONFIG_CHECK_INTERVAL = 15  # seconds


async def _close_old(service: EmbeddingService) -> None:
    """Close an old client after a grace period for in-flight requests."""
    await asyncio.sleep(30)
    try:
        await service.close()
    except Exception:
        logger.opt(exception=True).warning("Failed to close old embedding service")


def get_embedding_service() -> EmbeddingService:
    global _embedding_service, _embedding_config, _last_config_check

    now = time.monotonic()
    if _embedding_service is not None and (now - _last_config_check) < _CONFIG_CHECK_INTERVAL:
        return _embedding_service

    _last_config_check = now
    try:
        config = settings.get_embedding_config()  # (base_url, api_key, model, dims)
    except (ValueError, OSError):
        logger.opt(exception=True).warning("Config read failed, keeping current embedding client")
        if _embedding_service is not None:
            return _embedding_service
        raise

    if config == _embedding_config and _embedding_service is not None:
        return _embedding_service

    base_url, api_key, model, dims = config

    # Never downgrade to empty key
    if not api_key and _embedding_service is not None:
        logger.warning("Skipping embedding reload: new config has empty API key")
        return _embedding_service

    # Refuse dimension change (would corrupt vector index)
    if _embedding_config is not None and dims != _embedding_config[3] and _embedding_service is not None:
        logger.error(
            "Embedding dimensions changed ({} -> {}). Restart required to re-index.",
            _embedding_config[3],
            dims,
        )
        return _embedding_service

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
        with contextlib.suppress(RuntimeError):
            asyncio.get_running_loop().create_task(_close_old(old))
    else:
        logger.info("Embedding service created: model={}, dims={}", model, dims)

    return _embedding_service

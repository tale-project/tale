"""
OpenAI-compatible embedding generation service.

Crawler-specific factory with TTL-based config refresh, keyed by org
slug. Each org has its own EmbeddingService instance built from that
org's provider catalog at `<TALE_CONFIG_DIR>/<org>/providers/`.

Embedding dimensions are still implicitly global because crawler's
`database.py` pins a single dim per RAG index; if two orgs disagree on
dimensions we refuse to rebuild and keep the existing client (the
operator must reconcile provider configs).
"""

import asyncio
import contextlib
import time

from loguru import logger
from tale_knowledge.embedding import EmbeddingService

from app.config import settings
from app.org_context import get_active_org

_CONFIG_CHECK_INTERVAL = 15  # seconds


class _OrgEmbeddingState:
    __slots__ = ("config", "last_check", "service")

    def __init__(
        self,
        service: EmbeddingService,
        config: tuple,
        last_check: float,
    ) -> None:
        self.service = service
        self.config = config
        self.last_check = last_check


_org_states: dict[str, _OrgEmbeddingState] = {}


async def _close_old(service: EmbeddingService) -> None:
    """Close an old client after a grace period for in-flight requests."""
    await asyncio.sleep(30)
    try:
        await service.close()
    except Exception:
        logger.opt(exception=True).warning("Failed to close old embedding service")


def get_embedding_service() -> EmbeddingService:
    org_slug = get_active_org()
    state = _org_states.get(org_slug)

    now = time.monotonic()
    if state is not None and (now - state.last_check) < _CONFIG_CHECK_INTERVAL:
        return state.service

    try:
        config = settings.get_embedding_config(org_slug)  # (base_url, api_key, model, dims)
    except (ValueError, OSError):
        logger.opt(exception=True).warning(
            "Config read failed for org '{}', keeping current embedding client",
            org_slug,
        )
        if state is not None:
            state.last_check = now
            return state.service
        raise

    if state is not None and config == state.config:
        state.last_check = now
        return state.service

    base_url, api_key, model, dims = config

    # Never downgrade to empty key
    if not api_key and state is not None:
        logger.warning(
            "Skipping embedding reload for org '{}': new config has empty API key",
            org_slug,
        )
        state.last_check = now
        return state.service

    # Refuse dimension change (would corrupt vector index)
    if state is not None and dims != state.config[3]:
        logger.error(
            "Embedding dimensions for org '{}' changed ({} -> {}). Restart required to re-index.",
            org_slug,
            state.config[3],
            dims,
        )
        state.last_check = now
        return state.service

    old_service = state.service if state is not None else None
    new_service = EmbeddingService(
        api_key=api_key,
        base_url=base_url,
        model=model,
        dimensions=dims,
    )
    _org_states[org_slug] = _OrgEmbeddingState(
        service=new_service,
        config=config,
        last_check=now,
    )

    if old_service is not None:
        logger.info("Embedding service rebuilt for org '{}': model={}", org_slug, model)
        with contextlib.suppress(RuntimeError):
            asyncio.get_running_loop().create_task(_close_old(old_service))
    else:
        logger.info(
            "Embedding service created for org '{}': model={}, dims={}",
            org_slug,
            model,
            dims,
        )

    return new_service

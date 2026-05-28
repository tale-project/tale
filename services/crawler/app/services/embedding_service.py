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
from collections import OrderedDict

from loguru import logger
from tale_knowledge.embedding import EmbeddingService

from app.config import settings
from app.org_context import get_active_org
from app.services import database

_CONFIG_CHECK_INTERVAL = 15  # seconds

# Bounded LRU cap on the per-org embedding-service cache. Each entry
# holds an httpx connection pool, so a typo'd-slug spray or org churn
# used to slowly leak file descriptors. 64 is well above any realistic
# concurrent fan-out for a single crawler instance. Round-2 P1-25.
_ORG_CACHE_MAX = 64


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


_org_states: OrderedDict[str, _OrgEmbeddingState] = OrderedDict()


def _evict_lru_if_needed() -> None:
    """Pop the least-recently-used entry and schedule its client close.

    Called after every new insert. The previous unbounded dict held an
    AsyncOpenAI httpx pool per entry — under typo'd-slug churn that
    leaked sockets indefinitely.
    """
    while len(_org_states) > _ORG_CACHE_MAX:
        _victim_key, victim_state = _org_states.popitem(last=False)
        with contextlib.suppress(RuntimeError):
            asyncio.get_running_loop().create_task(_close_old(victim_state.service))


async def _close_old(service: EmbeddingService) -> None:
    """Close an old client after a grace period for in-flight requests.

    Matches the 300s window used for the chat/vision clients
    (`vision/openai_client.py:_safe_close_client`). The previous 30s
    grace was shorter than a long batch embed could legitimately
    take; tearing down the httpx pool mid-flight produced opaque
    "Event loop is closed" errors. Round-3 P2 R26-P2-b.
    """
    await asyncio.sleep(300)
    try:
        await service.close()
    except Exception:
        logger.opt(exception=True).warning("Failed to close old embedding service")


def get_embedding_service() -> EmbeddingService:
    org_slug = get_active_org()
    state = _org_states.get(org_slug)

    now = time.monotonic()
    if state is not None and (now - state.last_check) < _CONFIG_CHECK_INTERVAL:
        # LRU bump on access — without this, eviction order is FIFO
        # and a busy org could be evicted out from under in-flight
        # callers.
        _org_states.move_to_end(org_slug)
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
            _org_states.move_to_end(org_slug)
            return state.service
        raise

    if state is not None and config == state.config:
        state.last_check = now
        _org_states.move_to_end(org_slug)
        return state.service

    base_url, api_key, model, dims = config

    # Cross-org dim guard (P1-27). chunks.embedding is pinned ONCE at
    # boot from the `default` org's config; any other org whose config
    # disagrees would silently succeed here and crash at INSERT/search
    # time with a cryptic pgvector cast error. Reject at config-load.
    boot_dims = database.BOOT_PINNED_DIMS
    if boot_dims is not None and dims != boot_dims:
        raise RuntimeError(
            f"Embedding dimension conflict for org '{org_slug}': provider "
            f"config requests {dims}d but the shared chunks table is pinned "
            f"to {boot_dims}d (set by the 'default' org at crawler boot). "
            f"Either reconcile the org's provider catalog to match, or run "
            f"a separate crawler instance for this org."
        )

    # Never downgrade to empty key
    if not api_key and state is not None:
        logger.warning(
            "Skipping embedding reload for org '{}': new config has empty API key",
            org_slug,
        )
        state.last_check = now
        _org_states.move_to_end(org_slug)
        return state.service

    # Refuse same-org dimension change (would corrupt vector index)
    if state is not None and dims != state.config[3]:
        logger.error(
            "Embedding dimensions for org '{}' changed ({} -> {}). Restart required to re-index.",
            org_slug,
            state.config[3],
            dims,
        )
        state.last_check = now
        _org_states.move_to_end(org_slug)
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
    _org_states.move_to_end(org_slug)
    _evict_lru_if_needed()

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

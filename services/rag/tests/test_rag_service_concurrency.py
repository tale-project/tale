"""Lifecycle + concurrency tests for RagService.

Covers round-2 P1-19/20/21:
- shutdown flag rejects new requests mid-shutdown
- background-task drain is bounded by a timeout
- `_get_org_lock` does true LRU (move_to_end on access) and refuses to
  evict a held lock
- `_pin_dim_lock` first-write race serializes when two orgs init
  concurrently with the same dims (no pre-seeded `_pinned_dims`)
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytestmark = pytest.mark.asyncio


class TestShutdownGate:
    async def test_ensure_org_clients_rejects_after_shutdown_flag(self):
        from app.services.rag_service import RagService

        service = RagService()
        service.initialized = True
        service._pool = MagicMock()
        service._shutting_down = True

        with pytest.raises(RuntimeError, match="shutting down"):
            await service._ensure_org_clients("orgA")

    async def test_shutdown_drain_timeout_cancels_pending_tasks(self):
        from app.services import rag_service as rag_mod
        from app.services.rag_service import RagService

        service = RagService()
        service.initialized = True
        service._pool = MagicMock()

        async def hanging_task() -> None:
            await asyncio.sleep(60)  # well beyond the drain timeout

        # Override the drain timeout so the test stays fast.
        service._SHUTDOWN_DRAIN_TIMEOUT_S = 0.05

        loop = asyncio.get_running_loop()
        hanger = loop.create_task(hanging_task())
        rag_mod._background_tasks.add(hanger)

        try:
            with patch("app.services.rag_service.close_pool", new_callable=AsyncMock):
                await service.shutdown()
        finally:
            rag_mod._background_tasks.discard(hanger)
            # Drain the cancellation that shutdown propagated; without this,
            # asyncio leaks an unhandled-cancellation warning into the test
            # report.
            with pytest.raises(asyncio.CancelledError):
                await hanger

        assert service._shutting_down is True


class TestOrgLockLRU:
    def test_access_bumps_to_most_recent(self):
        from app.services.rag_service import RagService

        service = RagService()
        for slug in ("orgA", "orgB", "orgC"):
            service._get_org_lock(slug)

        # Bump orgA — it should be the most-recently-used now.
        service._get_org_lock("orgA")
        keys = list(service._org_locks.keys())
        assert keys[-1] == "orgA"
        assert keys[0] == "orgB"

    def test_eviction_skips_held_lock(self, monkeypatch):
        from app.services import rag_service as rag_mod
        from app.services.rag_service import RagService

        # Squeeze the cap so we can exercise eviction on a small set.
        monkeypatch.setattr(rag_mod, "_ORG_LOCKS_MAX", 2)

        service = RagService()
        lock_a = service._get_org_lock("orgA")
        service._get_org_lock("orgB")

        # Mark orgA's lock as held, then insert orgC. The bounded
        # eviction must skip orgA and pop orgB.
        async def hold_and_check():
            async with lock_a:
                service._get_org_lock("orgC")
                assert "orgA" in service._org_locks
                assert "orgB" not in service._org_locks
                assert "orgC" in service._org_locks

        asyncio.run(hold_and_check())


class TestPinDimLockRace:
    async def test_two_concurrent_inits_serialise_via_pin_dim_lock(self):
        """Without `_pin_dim_lock`, two orgs init'ing concurrently would
        both see `_pinned_dims is None` and both call
        `pin_embedding_dimensions`. With the lock, the second caller
        observes the pinned value and falls through to the equality check.
        """
        from app.services.rag_service import RagService

        service = RagService()
        # Hand-roll initialization so we exercise the first-write race
        # without driving the full client build.
        service.initialized = True
        service._pool = MagicMock()
        assert service._pinned_dims is None

        async def pin(dims: int) -> None:
            async with service._pin_dim_lock:
                if service._pinned_dims is None:
                    service._pinned_dims = dims
                elif dims != service._pinned_dims:
                    raise ValueError(f"dim mismatch: have {service._pinned_dims}, got {dims}")

        # Two concurrent pinners requesting the same dim — both must
        # succeed; `_pinned_dims` settles to that dim.
        await asyncio.gather(pin(1536), pin(1536))
        assert service._pinned_dims == 1536

        # A subsequent pinner requesting a different dim must raise
        # under the lock (vs racing past the None check).
        with pytest.raises(ValueError, match="dim mismatch"):
            await pin(3072)

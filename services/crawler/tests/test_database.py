"""Tests for database pool initialization, including the boot-time
embedding-column dimension pin.

The baseline migration declares `chunks.embedding` as bare `vector`
(no dim). Without an explicit pin pgvector accepts mixed-dim inserts
silently and the HNSW index can't be built. `init_pool` resolves
the deployment-wide dim from the `default` org's provider catalog
and `ALTER TABLE`-pins the column at boot.
"""

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, patch

import pytest

import app.services.database as db_mod


@pytest.fixture(autouse=True)
def _reset_pool():
    """Ensure module-level _pool is reset before and after each test."""
    db_mod._pool = None
    yield
    db_mod._pool = None


def _fake_pool():
    """Build a mock asyncpg pool with a tracked single connection."""
    conn = AsyncMock()
    conn.execute = AsyncMock()

    pool = AsyncMock()
    pool.close = AsyncMock()
    pool._test_conn = conn

    @asynccontextmanager
    async def _acq(_pool, **_kw):
        yield conn

    return pool, _acq


class TestEmbeddingColumnPin:
    @pytest.mark.asyncio
    async def test_pins_column_at_boot(self):
        """init_pool issues ALTER TABLE … TYPE vector(N) using default-org dim."""
        fake_pool, acq = _fake_pool()

        with (
            patch("app.services.database.asyncpg.create_pool", AsyncMock(return_value=fake_pool)),
            patch("app.services.database.acquire_with_retry", acq),
            patch("app.services.database.settings") as mock_settings,
        ):
            mock_settings.get_embedding_config.return_value = (
                "https://api.example.com",
                "sk-test",
                "text-embedding-3-small",
                1536,
            )
            mock_settings.database_url = "postgresql://test:test@localhost/test"

            await db_mod.init_pool()

        mock_settings.get_embedding_config.assert_called_once_with("default")
        conn = fake_pool._test_conn
        execute_calls = [str(c) for c in conn.execute.call_args_list]
        assert any("ALTER TABLE" in c and "vector(1536)" in c for c in execute_calls)
        # HNSW index creation is attempted after the pin.
        assert any("create_chunks_hnsw_index" in c for c in execute_calls)

    @pytest.mark.asyncio
    async def test_uses_default_org_dim(self):
        """ALTER TABLE uses whatever dim the default org's provider returns."""
        fake_pool, acq = _fake_pool()

        with (
            patch("app.services.database.asyncpg.create_pool", AsyncMock(return_value=fake_pool)),
            patch("app.services.database.acquire_with_retry", acq),
            patch("app.services.database.settings") as mock_settings,
        ):
            mock_settings.get_embedding_config.return_value = (
                "https://api.example.com",
                "sk-test",
                "nomic-embed-text",
                768,
            )
            mock_settings.database_url = "postgresql://test:test@localhost/test"

            await db_mod.init_pool()

        conn = fake_pool._test_conn
        execute_calls = [str(c) for c in conn.execute.call_args_list]
        assert any("ALTER TABLE" in c and "vector(768)" in c for c in execute_calls)

    @pytest.mark.asyncio
    async def test_raises_when_default_org_provider_unconfigured(self):
        """Without a default-org provider, boot fails loudly rather than
        proceeding with an unpinned column (silent regression risk)."""
        fake_pool, acq = _fake_pool()

        with (
            patch("app.services.database.asyncpg.create_pool", AsyncMock(return_value=fake_pool)),
            patch("app.services.database.acquire_with_retry", acq),
            patch("app.services.database.settings") as mock_settings,
        ):
            mock_settings.get_embedding_config.side_effect = ValueError(
                "no embedding provider configured for org 'default'"
            )
            mock_settings.database_url = "postgresql://test:test@localhost/test"

            with pytest.raises(RuntimeError, match="default"):
                await db_mod.init_pool()

        assert db_mod._pool is None

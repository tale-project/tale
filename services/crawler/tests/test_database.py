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
    """Ensure module-level _pool and BOOT_PINNED_DIMS are reset before and after each test."""
    db_mod._pool = None
    db_mod.BOOT_PINNED_DIMS = None
    yield
    db_mod._pool = None
    db_mod.BOOT_PINNED_DIMS = None


def _fake_pool(*, fetchval_returns=None):
    """Build a mock asyncpg pool with a tracked single connection.

    `fetchval_returns` controls what the pre-pin format_type probe returns
    (string `vector(N)` for already-pinned, `vector` for fresh baseline,
    None for a row that doesn't exist).
    """
    conn = AsyncMock()
    conn.execute = AsyncMock()
    conn.fetchval = AsyncMock(return_value=fetchval_returns)

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

    @pytest.mark.asyncio
    async def test_raises_on_pinned_dim_mismatch(self):
        """If the column is already pinned to vector(N) and the
        configured dim differs, boot must fail loudly rather than
        silently ALTER (and orphan existing rows). Restoration of the
        legible error round-2 P1-24 reported was lost in the move to
        the post-refactor unconditional ALTER.
        """
        fake_pool, acq = _fake_pool(fetchval_returns="vector(768)")

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

            with pytest.raises(RuntimeError, match="dimension mismatch"):
                await db_mod.init_pool()

        # Pool got rolled back; the module never recorded a pinned dim.
        assert db_mod._pool is None
        assert db_mod.BOOT_PINNED_DIMS is None

    @pytest.mark.asyncio
    async def test_skips_alter_when_already_correctly_pinned(self):
        """No-op the unconditional ALTER when the existing pin already
        matches the configured dim. Avoids the AccessExclusiveLock on
        the chunks table on every boot (round-2 P1-24).
        """
        fake_pool, acq = _fake_pool(fetchval_returns="vector(1536)")

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

        conn = fake_pool._test_conn
        execute_calls = [str(c) for c in conn.execute.call_args_list]
        # ALTER not run; HNSW index attempt still happens.
        assert not any("ALTER TABLE" in c for c in execute_calls)
        assert any("create_chunks_hnsw_index" in c for c in execute_calls)
        # BOOT_PINNED_DIMS still recorded for cross-org guards.
        assert db_mod.BOOT_PINNED_DIMS == 1536

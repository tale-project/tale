"""Tests for database pool initialization, including dimension mismatch guard."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import app.services.database as db_mod


@pytest.fixture(autouse=True)
def _reset_pool():
    """Ensure module-level _pool is reset before and after each test."""
    db_mod._pool = None
    yield
    db_mod._pool = None


def _fake_pool(stored_dims: int | None):
    """Build a mock asyncpg pool whose fetchval returns *stored_dims*."""
    conn = AsyncMock()
    conn.fetchval = AsyncMock(return_value=stored_dims)
    conn.execute = AsyncMock()

    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=conn)
    ctx.__aexit__ = AsyncMock(return_value=False)

    pool = AsyncMock()
    pool.acquire = MagicMock(return_value=ctx)
    pool.close = AsyncMock()
    return pool


class TestDimensionMismatchGuard:
    @pytest.mark.asyncio
    async def test_raises_on_dimension_mismatch(self):
        fake_pool = _fake_pool(stored_dims=3072)

        with (
            patch("app.services.database.asyncpg.create_pool", AsyncMock(return_value=fake_pool)),
            patch("app.services.database.settings") as mock_settings,
        ):
            mock_settings.get_embedding_dimensions.return_value = 1536
            mock_settings.database_url = "postgresql://test:test@localhost/test"

            with pytest.raises(RuntimeError, match="dimension mismatch"):
                await db_mod.init_pool()

        assert db_mod._pool is None

    @pytest.mark.asyncio
    async def test_passes_when_dimensions_match(self):
        fake_pool = _fake_pool(stored_dims=1536)

        with (
            patch("app.services.database.asyncpg.create_pool", AsyncMock(return_value=fake_pool)),
            patch("app.services.database.settings") as mock_settings,
        ):
            mock_settings.get_embedding_dimensions.return_value = 1536
            mock_settings.database_url = "postgresql://test:test@localhost/test"

            pool = await db_mod.init_pool()

        assert pool is fake_pool

    @pytest.mark.asyncio
    async def test_passes_when_no_existing_data(self):
        fake_pool = _fake_pool(stored_dims=None)

        with (
            patch("app.services.database.asyncpg.create_pool", AsyncMock(return_value=fake_pool)),
            patch("app.services.database.settings") as mock_settings,
        ):
            mock_settings.get_embedding_dimensions.return_value = 1536
            mock_settings.database_url = "postgresql://test:test@localhost/test"

            pool = await db_mod.init_pool()

        assert pool is fake_pool

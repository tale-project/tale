"""Tests for database pool initialization, including dimension mismatch guard."""

from unittest.mock import AsyncMock, MagicMock, call, patch

import pytest

import app.services.database as db_mod


@pytest.fixture(autouse=True)
def _reset_pool():
    """Ensure module-level _pool is reset before and after each test."""
    db_mod._pool = None
    yield
    db_mod._pool = None


def _fake_pool(stored_dims: int | None, col_type: str = "vector(1536)"):
    """Build a mock asyncpg pool.

    *stored_dims* is returned for the first fetchval (dimension check).
    *col_type* is returned for the second fetchval (column type check).
    """
    conn = AsyncMock()
    conn.fetchval = AsyncMock(side_effect=[stored_dims, col_type])
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
        fake_pool = _fake_pool(stored_dims=1536, col_type="vector(1536)")

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
        fake_pool = _fake_pool(stored_dims=None, col_type="vector")

        with (
            patch("app.services.database.asyncpg.create_pool", AsyncMock(return_value=fake_pool)),
            patch("app.services.database.settings") as mock_settings,
        ):
            mock_settings.get_embedding_dimensions.return_value = 1536
            mock_settings.database_url = "postgresql://test:test@localhost/test"

            pool = await db_mod.init_pool()

        assert pool is fake_pool


class TestEmbeddingColumnPinning:
    @pytest.mark.asyncio
    async def test_alters_untyped_vector_column(self):
        """When column is bare `vector`, init_pool pins it to vector(N)."""
        fake_pool = _fake_pool(stored_dims=None, col_type="vector")

        with (
            patch("app.services.database.asyncpg.create_pool", AsyncMock(return_value=fake_pool)),
            patch("app.services.database.settings") as mock_settings,
        ):
            mock_settings.get_embedding_dimensions.return_value = 768
            mock_settings.database_url = "postgresql://test:test@localhost/test"

            await db_mod.init_pool()

        conn = fake_pool.acquire().__aenter__.return_value
        execute_calls = [str(c) for c in conn.execute.call_args_list]
        assert any("ALTER TABLE" in c and "vector(768)" in c for c in execute_calls)

    @pytest.mark.asyncio
    async def test_skips_alter_when_already_typed(self):
        """When column already has dimensions, no ALTER is issued."""
        fake_pool = _fake_pool(stored_dims=1536, col_type="vector(1536)")

        with (
            patch("app.services.database.asyncpg.create_pool", AsyncMock(return_value=fake_pool)),
            patch("app.services.database.settings") as mock_settings,
        ):
            mock_settings.get_embedding_dimensions.return_value = 1536
            mock_settings.database_url = "postgresql://test:test@localhost/test"

            await db_mod.init_pool()

        conn = fake_pool.acquire().__aenter__.return_value
        execute_calls = [str(c) for c in conn.execute.call_args_list]
        assert not any("ALTER TABLE" in c for c in execute_calls)

    @pytest.mark.asyncio
    async def test_repins_column_when_dimension_changed(self):
        """When column is pinned to a different dimension and table is empty, re-pin."""
        fake_pool = _fake_pool(stored_dims=None, col_type="vector(2560)")

        with (
            patch("app.services.database.asyncpg.create_pool", AsyncMock(return_value=fake_pool)),
            patch("app.services.database.settings") as mock_settings,
        ):
            mock_settings.get_embedding_dimensions.return_value = 1536
            mock_settings.database_url = "postgresql://test:test@localhost/test"

            await db_mod.init_pool()

        conn = fake_pool.acquire().__aenter__.return_value
        execute_calls = [str(c) for c in conn.execute.call_args_list]
        assert any("DROP INDEX" in c and "idx_pw_chunks_embedding_hnsw" in c for c in execute_calls)
        assert any("ALTER TABLE" in c and "vector(1536)" in c for c in execute_calls)

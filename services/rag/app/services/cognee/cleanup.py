"""Cognee data cleanup and migration utilities.

This module provides functions to:
- Clean up stale or legacy data rows that reference files that no longer exist
- Migrate vector tables when embedding dimensions change
- Create HNSW indexes on vector tables for fast similarity search
"""

import os
from urllib.parse import urlparse

from loguru import logger

from ...config import settings


async def ensure_vector_hnsw_indexes() -> dict:
    """Create HNSW indexes on all PGVector tables that don't have one.

    Cognee creates vector tables dynamically (one per collection/dataset).
    Without HNSW indexes, queries on large datasets (200k+ vectors) can take
    5-15 seconds. With HNSW indexes, queries complete in <500ms.

    This function is idempotent - it only creates indexes that don't exist.

    Returns:
        Dict with 'created' (list of index names) and 'existing' (count).
    """
    result = {"created": [], "existing": 0, "errors": []}

    try:
        import asyncpg

        db_url = settings.get_database_url()
        parsed = urlparse(db_url)

        if parsed.scheme not in ("postgresql", "postgres"):
            logger.debug(
                "Unsupported database scheme '{}', skipping HNSW index creation",
                parsed.scheme,
            )
            return result

        conn = await asyncpg.connect(
            host=parsed.hostname or "localhost",
            port=parsed.port or 5432,
            database=parsed.path.lstrip("/") if parsed.path else "",
            user=parsed.username or "",
            password=parsed.password or "",
        )

        try:
            # Find all tables with vector columns
            vector_columns = await conn.fetch(
                """
                SELECT
                    c.relname as table_name,
                    a.attname as column_name
                FROM pg_class c
                JOIN pg_attribute a ON a.attrelid = c.oid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE c.relkind = 'r'
                AND n.nspname = 'public'
                AND a.attnum > 0
                AND pg_catalog.format_type(a.atttypid, a.atttypmod) LIKE 'vector%'
                ORDER BY c.relname
                """
            )

            if not vector_columns:
                logger.debug("No vector tables found, skipping HNSW index creation")
                return result

            for row in vector_columns:
                table_name = row["table_name"]
                column_name = row["column_name"]
                index_name = f"{table_name}_{column_name}_hnsw_idx"

                # Check if index already exists
                exists = await conn.fetchval(
                    """
                    SELECT EXISTS (
                        SELECT 1 FROM pg_indexes
                        WHERE schemaname = 'public'
                        AND indexname = $1
                    )
                    """,
                    index_name,
                )

                if exists:
                    result["existing"] += 1
                    continue

                # Create HNSW index
                try:
                    logger.info(
                        "Creating HNSW index: {} on {}.{}",
                        index_name,
                        table_name,
                        column_name,
                    )
                    # Use cosine distance (most common for embeddings)
                    # m=16, ef_construction=64 are good defaults
                    await conn.execute(
                        f'CREATE INDEX "{index_name}" ON "{table_name}" '
                        f'USING hnsw ("{column_name}" vector_cosine_ops) '
                        f"WITH (m = 16, ef_construction = 64)"
                    )
                    result["created"].append(index_name)
                    logger.info("Created HNSW index: {}", index_name)
                except Exception as e:
                    error_msg = f"Failed to create index {index_name}: {e}"
                    logger.error(error_msg)
                    result["errors"].append(error_msg)

        finally:
            await conn.close()

        if result["created"]:
            logger.info(
                "HNSW index creation complete: {} created, {} already existed",
                len(result["created"]),
                result["existing"],
            )
        elif result["existing"] > 0:
            logger.debug(
                "All {} vector column(s) already have HNSW indexes",
                result["existing"],
            )

    except ImportError:
        logger.debug(
            "asyncpg not available, skipping HNSW index creation. "
            "Install asyncpg to enable automatic index management."
        )
    except Exception as e:
        logger.error("HNSW index creation failed: {}", e)
        result["errors"].append(str(e))

    return result


async def migrate_vector_dimensions() -> None:
    """Check and migrate vector tables if embedding dimensions have changed.

    When the embedding model is changed to one with different output dimensions,
    existing PostgreSQL vector tables will have mismatched dimensions. This causes
    INSERT errors like "expected 3072 dimensions, not 2560".

    This function:
    1. Reads the expected dimensions from EMBEDDING_DIMENSIONS env var
    2. Queries PostgreSQL to find tables with vector columns
    3. Compares actual vs expected dimensions
    4. Drops tables with mismatched dimensions so they'll be recreated

    Note: This causes data loss for affected vector tables. The underlying
    document data in other tables is preserved, but vector embeddings must
    be re-generated by re-ingesting documents.
    """
    try:
        expected_dimensions = settings.get_embedding_dimensions()
    except ValueError as e:
        logger.error("Cannot migrate vector dimensions: {}", e)
        raise

    try:
        import asyncpg

        # Parse database URL using urlparse for robustness
        db_url = settings.get_database_url()
        parsed = urlparse(db_url)

        if parsed.scheme not in ("postgresql", "postgres"):
            logger.warning(
                "Unsupported database URL scheme '{}', skipping vector dimension migration",
                parsed.scheme,
            )
            return

        user = parsed.username or ""
        password = parsed.password or ""
        host = parsed.hostname or "localhost"
        port = parsed.port or 5432
        db = parsed.path.lstrip("/") if parsed.path else ""

        conn = await asyncpg.connect(
            host=host,
            port=port,
            database=db,
            user=user,
            password=password,
        )

        try:
            # Find all tables with vector columns and their dimensions
            vector_tables = await conn.fetch(
                """
                SELECT
                    c.relname as table_name,
                    a.attname as column_name,
                    pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type
                FROM pg_class c
                JOIN pg_attribute a ON a.attrelid = c.oid
                WHERE c.relkind = 'r'
                AND a.attnum > 0
                AND pg_catalog.format_type(a.atttypid, a.atttypmod) LIKE 'vector%'
                ORDER BY c.relname
                """
            )

            if not vector_tables:
                logger.info(
                    "No vector tables found in database, skipping dimension migration"
                )
                return

            # Parse dimensions from data_type like "vector(3072)"
            mismatched_tables = []
            for row in vector_tables:
                table_name = row["table_name"]
                data_type = row["data_type"]

                # Extract dimension from "vector(N)"
                if "(" in data_type and ")" in data_type:
                    dim_str = data_type.split("(")[1].split(")")[0]
                    try:
                        actual_dim = int(dim_str)
                        if actual_dim != expected_dimensions:
                            mismatched_tables.append(
                                {
                                    "table": table_name,
                                    "column": row["column_name"],
                                    "actual": actual_dim,
                                    "expected": expected_dimensions,
                                }
                            )
                    except ValueError:
                        logger.warning(
                            "Could not parse dimension from {}: {}",
                            table_name,
                            data_type,
                        )

            if not mismatched_tables:
                logger.info(
                    "All {} vector table(s) have correct dimensions ({})",
                    len(vector_tables),
                    expected_dimensions,
                )
                return

            # Log and drop mismatched tables
            logger.warning(
                "Found {} vector table(s) with mismatched dimensions:",
                len(mismatched_tables),
            )
            for info in mismatched_tables:
                logger.warning(
                    "  - {}.{}: {} (expected {})",
                    info["table"],
                    info["column"],
                    info["actual"],
                    info["expected"],
                )

            # Drop mismatched tables
            dropped_count = 0
            for info in mismatched_tables:
                table_name = info["table"]
                try:
                    await conn.execute(f'DROP TABLE IF EXISTS "{table_name}" CASCADE')
                    logger.info("Dropped vector table: {}", table_name)
                    dropped_count += 1
                except Exception as e:
                    logger.error("Failed to drop table {}: {}", table_name, e)

            logger.warning(
                "Dropped {} vector table(s) with mismatched dimensions. "
                "Tables will be recreated with {} dimensions on next ingestion. "
                "You may need to re-ingest documents to rebuild vector embeddings.",
                dropped_count,
                expected_dimensions,
            )

        finally:
            await conn.close()

    except ImportError:
        logger.warning(
            "asyncpg not available, skipping vector dimension migration. "
            "Install asyncpg to enable automatic dimension migration."
        )
    except Exception as e:
        logger.error("Vector dimension migration failed: {}", e)
        # Don't raise - allow service to continue, user may want to fix manually


async def cleanup_legacy_site_packages_data() -> None:
    """Remove legacy Cognee Data rows pointing at site-packages .data_storage.

    Earlier versions of our Cognee integration used the default data_root_directory
    under the installed package path (e.g. /usr/local/lib/python3.11/site-packages/
    cognee/.data_storage). Those records now reference files that no longer exist
    after rebuilding the container, and cause FileNotFoundError during cognify().

    This helper runs once on initialization and deletes only rows whose
    raw_data_location still points at the old site-packages path, leaving
    all new data (under /app/data/.data_storage) untouched.
    """
    try:
        from sqlalchemy import select
        from cognee.infrastructure.databases.relational import get_async_session
        from cognee.modules.data.models import Data

        legacy_substring = "/site-packages/cognee/.data_storage/"

        async with get_async_session(auto_commit=False) as session:
            result = await session.execute(
                select(Data).where(Data.raw_data_location.contains(legacy_substring))
            )
            legacy_rows = result.scalars().all()

            if not legacy_rows:
                logger.info("No legacy Cognee data rows found under site-packages .data_storage")
                return

            count = 0
            for row in legacy_rows:
                await session.delete(row)
                count += 1

            await session.commit()
            logger.warning(
                "Removed {} legacy Cognee data rows with raw_data_location containing {}",
                count,
                legacy_substring,
            )
    except Exception as cleanup_err:
        if "UndefinedTableError" in str(type(cleanup_err).__name__) or "does not exist" in str(
            cleanup_err
        ):
            logger.warning(
                "Cognee data table does not exist yet, skipping legacy cleanup (this is normal on first run)"
            )
        else:
            logger.error("Failed to cleanup legacy Cognee data rows: {}", cleanup_err)


async def cleanup_missing_local_files_data() -> None:
    """Remove Cognee Data rows whose local files no longer exist.

    When the container image is rebuilt, any files previously written under the
    Cognee data_root_directory (e.g. /app/data/.data_storage) are lost unless
    that path is backed by a persistent volume. However, the relational
    database rows in cognee.modules.data.models.Data still reference the old
    file paths. During cognify() this results in FileNotFoundError when
    TextDocument readers try to open those files.

    This helper deletes Data rows that:
    - Have a raw_data_location pointing under the current data_root_directory,
    - But whose underlying filesystem path no longer exists.
    """
    try:
        from sqlalchemy import select
        from cognee.infrastructure.databases.relational import get_async_session
        from cognee.modules.data.models import Data

        base_data_dir = os.path.abspath(settings.cognee_data_dir)
        data_root_prefix = os.path.join(base_data_dir, ".data_storage")

        async with get_async_session(auto_commit=False) as session:
            result = await session.execute(select(Data))
            rows = result.scalars().all()

            if not rows:
                logger.info("No Cognee data rows found for missing-file cleanup")
                return

            missing_rows = []
            for row in rows:
                location = getattr(row, "raw_data_location", None)
                if not location:
                    continue

                # Only consider file:// URLs or absolute paths
                if isinstance(location, str) and location.startswith("file://"):
                    parsed = urlparse(location)
                    fs_path = parsed.path
                else:
                    fs_path = str(location)

                # Restrict cleanup to the current data_root_prefix to avoid
                # accidentally deleting rows managed by other storage backends.
                # Use realpath to resolve symlinks and prevent path traversal attacks.
                try:
                    real_path = os.path.realpath(fs_path)
                    real_prefix = os.path.realpath(data_root_prefix)
                    # Ensure the resolved path is actually within our data directory
                    if os.path.commonpath([real_path, real_prefix]) != real_prefix:
                        continue
                except (ValueError, OSError):
                    # commonpath raises ValueError if paths are on different drives (Windows)
                    # or OSError for invalid paths
                    continue

                if not os.path.exists(real_path):
                    missing_rows.append(row)

            if not missing_rows:
                logger.info(
                    "No Cognee data rows with missing local files under {}",
                    data_root_prefix,
                )
                return

            count = 0
            for row in missing_rows:
                await session.delete(row)
                count += 1

            await session.commit()
            logger.warning(
                "Removed {} Cognee data rows whose local files no longer exist under {}",
                count,
                data_root_prefix,
            )
    except Exception as cleanup_err:
        if "UndefinedTableError" in str(type(cleanup_err).__name__) or "does not exist" in str(
            cleanup_err
        ):
            logger.warning(
                "Cognee data table does not exist yet, skipping missing-file cleanup (this is normal on first run)"
            )
        else:
            logger.error(
                "Failed to cleanup Cognee data rows with missing local files: {}",
                cleanup_err,
            )


"""Cognee data cleanup utilities.

This module provides functions to clean up stale or legacy data rows
in the Cognee database that reference files that no longer exist.
"""

import os
from urllib.parse import urlparse

from loguru import logger

from ...config import settings


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
                "Removed %d legacy Cognee data rows with raw_data_location containing %s",
                count,
                legacy_substring,
            )
    except Exception as cleanup_err:
        logger.error("Failed to cleanup legacy Cognee data rows: %s", cleanup_err)


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
                if not fs_path.startswith(data_root_prefix):
                    continue

                if not os.path.exists(fs_path):
                    missing_rows.append(row)

            if not missing_rows:
                logger.info(
                    "No Cognee data rows with missing local files under %s",
                    data_root_prefix,
                )
                return

            count = 0
            for row in missing_rows:
                await session.delete(row)
                count += 1

            await session.commit()
            logger.warning(
                "Removed %d Cognee data rows whose local files no longer exist under %s",
                count,
                data_root_prefix,
            )
    except Exception as cleanup_err:
        logger.error(
            "Failed to cleanup Cognee data rows with missing local files: %s",
            cleanup_err,
        )


"""PostgreSQL-based job status storage for ingestion jobs.

This module tracks ingestion jobs using a PostgreSQL table instead of JSON files.
Benefits over file-based storage:
- Persistent across container restarts
- Supports multi-instance deployment
- Better query performance with indexing
- Atomic operations with transactions
"""

from __future__ import annotations

import time
from contextlib import asynccontextmanager
from typing import Any

import asyncpg
from loguru import logger

from ..config import settings
from ..models import JobState, JobStatus

# Connection pool (initialized lazily)
_pool: asyncpg.Pool | None = None


async def _get_pool() -> asyncpg.Pool:
    """Get or create the connection pool."""
    global _pool
    if _pool is None:
        db_url = settings.get_database_url()
        _pool = await asyncpg.create_pool(
            db_url,
            min_size=2,
            max_size=10,
            command_timeout=30,
        )
        logger.info("Created PostgreSQL connection pool for job store")
    return _pool


@asynccontextmanager
async def _get_connection():
    """Get a connection from the pool."""
    pool = await _get_pool()
    async with pool.acquire() as conn:
        yield conn


async def init_job_store() -> None:
    """Initialize the job store table if it doesn't exist.

    This should be called during service startup.
    """
    async with _get_connection() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS rag_jobs (
                job_id TEXT PRIMARY KEY,
                document_id TEXT,
                state TEXT NOT NULL DEFAULT 'queued',
                chunks_created INTEGER NOT NULL DEFAULT 0,
                message TEXT,
                error TEXT,
                skipped BOOLEAN NOT NULL DEFAULT FALSE,
                skip_reason TEXT,
                created_at DOUBLE PRECISION NOT NULL,
                updated_at DOUBLE PRECISION NOT NULL
            )
        """)
        # Create indexes for common queries
        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_rag_jobs_state ON rag_jobs(state)
        """)
        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_rag_jobs_updated_at ON rag_jobs(updated_at)
        """)
        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_rag_jobs_document_id ON rag_jobs(document_id)
        """)
        logger.info("Initialized rag_jobs table")


async def close_pool() -> None:
    """Close the connection pool.

    This should be called during service shutdown.
    """
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
        logger.info("Closed PostgreSQL connection pool for job store")


def _row_to_job_status(row: asyncpg.Record) -> JobStatus:
    """Convert a database row to JobStatus model."""
    return JobStatus(
        job_id=row["job_id"],
        document_id=row["document_id"],
        state=JobState(row["state"]),
        chunks_created=row["chunks_created"],
        message=row["message"],
        error=row["error"],
        skipped=row["skipped"],
        skip_reason=row["skip_reason"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


async def get_job(job_id: str) -> JobStatus | None:
    """Load job status from database.

    Returns None if no job with this id exists.
    """
    async with _get_connection() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM rag_jobs WHERE job_id = $1",
            job_id,
        )
        if row is None:
            return None
        return _row_to_job_status(row)


async def create_queued(job_id: str, document_id: str | None) -> JobStatus:
    """Create an initial queued job record.

    If a job with this ID already exists, it will be replaced.
    """
    now = time.time()
    status = JobStatus(
        job_id=job_id,
        document_id=document_id,
        state=JobState.QUEUED,
        chunks_created=0,
        message="Queued for ingestion",
        error=None,
        skipped=False,
        skip_reason=None,
        created_at=now,
        updated_at=now,
    )

    async with _get_connection() as conn:
        await conn.execute(
            """
            INSERT INTO rag_jobs (
                job_id, document_id, state, chunks_created, message,
                error, skipped, skip_reason, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (job_id) DO UPDATE SET
                document_id = EXCLUDED.document_id,
                state = EXCLUDED.state,
                chunks_created = EXCLUDED.chunks_created,
                message = EXCLUDED.message,
                error = EXCLUDED.error,
                skipped = EXCLUDED.skipped,
                skip_reason = EXCLUDED.skip_reason,
                created_at = EXCLUDED.created_at,
                updated_at = EXCLUDED.updated_at
            """,
            status.job_id,
            status.document_id,
            status.state.value,
            status.chunks_created,
            status.message,
            status.error,
            status.skipped,
            status.skip_reason,
            status.created_at,
            status.updated_at,
        )

    return status


async def mark_running(job_id: str) -> None:
    """Mark a job as running.

    If the job does not exist yet, creates a minimal record.
    """
    now = time.time()

    async with _get_connection() as conn:
        result = await conn.execute(
            """
            UPDATE rag_jobs
            SET state = $1, message = $2, error = NULL, updated_at = $3
            WHERE job_id = $4
            """,
            JobState.RUNNING.value,
            "Ingestion started",
            now,
            job_id,
        )

        if result == "UPDATE 0":
            # Job doesn't exist, create it
            await conn.execute(
                """
                INSERT INTO rag_jobs (
                    job_id, document_id, state, chunks_created, message,
                    error, skipped, skip_reason, created_at, updated_at
                )
                VALUES ($1, NULL, $2, 0, $3, NULL, FALSE, NULL, $4, $5)
                """,
                job_id,
                JobState.RUNNING.value,
                "Ingestion started",
                now,
                now,
            )


async def mark_completed(
    job_id: str,
    *,
    document_id: str | None,
    chunks_created: int,
    skipped: bool = False,
    skip_reason: str | None = None,
) -> None:
    """Mark a job as completed successfully.

    Args:
        job_id: The job identifier
        document_id: The document identifier
        chunks_created: Number of chunks created (0 if skipped)
        skipped: Whether ingestion was skipped (e.g., content unchanged)
        skip_reason: Reason for skipping (e.g., 'content_unchanged')
    """
    now = time.time()
    message = "Ingestion skipped (content unchanged)" if skipped else "Ingestion completed"

    async with _get_connection() as conn:
        result = await conn.execute(
            """
            UPDATE rag_jobs
            SET state = $1, document_id = COALESCE($2, document_id), chunks_created = $3,
                message = $4, error = NULL, skipped = $5, skip_reason = $6, updated_at = $7
            WHERE job_id = $8
            """,
            JobState.COMPLETED.value,
            document_id,
            chunks_created,
            message,
            skipped,
            skip_reason,
            now,
            job_id,
        )

        if result == "UPDATE 0":
            # Job doesn't exist, create it
            await conn.execute(
                """
                INSERT INTO rag_jobs (
                    job_id, document_id, state, chunks_created, message,
                    error, skipped, skip_reason, created_at, updated_at
                )
                VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8, $9)
                """,
                job_id,
                document_id,
                JobState.COMPLETED.value,
                chunks_created,
                message,
                skipped,
                skip_reason,
                now,
                now,
            )


async def mark_failed(job_id: str, *, error: str) -> None:
    """Mark a job as failed with the given error message."""
    now = time.time()

    async with _get_connection() as conn:
        result = await conn.execute(
            """
            UPDATE rag_jobs
            SET state = $1, message = $2, error = $3, updated_at = $4
            WHERE job_id = $5
            """,
            JobState.FAILED.value,
            "Ingestion failed",
            error,
            now,
            job_id,
        )

        if result == "UPDATE 0":
            # Job doesn't exist, create it
            await conn.execute(
                """
                INSERT INTO rag_jobs (
                    job_id, document_id, state, chunks_created, message,
                    error, skipped, skip_reason, created_at, updated_at
                )
                VALUES ($1, NULL, $2, 0, $3, $4, FALSE, NULL, $5, $6)
                """,
                job_id,
                JobState.FAILED.value,
                "Ingestion failed",
                error,
                now,
                now,
            )


async def get_jobs_batch(job_ids: list[str]) -> dict[str, JobStatus | None]:
    """Load multiple job statuses from database.

    Returns a dictionary mapping job_id to JobStatus (or None if not found).
    """
    if not job_ids:
        return {}

    async with _get_connection() as conn:
        rows = await conn.fetch(
            "SELECT * FROM rag_jobs WHERE job_id = ANY($1)",
            job_ids,
        )

    result: dict[str, JobStatus | None] = {job_id: None for job_id in job_ids}
    for row in rows:
        result[row["job_id"]] = _row_to_job_status(row)

    return result


async def list_all_jobs(
    *,
    limit: int = 1000,
    offset: int = 0,
    state: JobState | None = None,
) -> list[JobStatus]:
    """List job statuses from database.

    Args:
        limit: Maximum number of jobs to return
        offset: Number of jobs to skip
        state: Optional filter by job state

    Returns:
        List of JobStatus objects
    """
    async with _get_connection() as conn:
        if state is not None:
            rows = await conn.fetch(
                """
                SELECT * FROM rag_jobs
                WHERE state = $1
                ORDER BY updated_at DESC
                LIMIT $2 OFFSET $3
                """,
                state.value,
                limit,
                offset,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT * FROM rag_jobs
                ORDER BY updated_at DESC
                LIMIT $1 OFFSET $2
                """,
                limit,
                offset,
            )

    return [_row_to_job_status(row) for row in rows]


async def delete_job(job_id: str) -> bool:
    """Delete a single job from database.

    Returns True if the job was deleted, False if it did not exist.
    """
    async with _get_connection() as conn:
        result = await conn.execute(
            "DELETE FROM rag_jobs WHERE job_id = $1",
            job_id,
        )
        return result == "DELETE 1"


async def clear_all_jobs() -> int:
    """Delete all job records from database.

    Returns the number of jobs deleted.
    """
    async with _get_connection() as conn:
        result = await conn.execute("DELETE FROM rag_jobs")
        # Result is like "DELETE 42"
        try:
            return int(result.split()[-1])
        except (IndexError, ValueError):
            return 0


async def get_job_stats() -> dict[str, Any]:
    """Get statistics about jobs.

    Returns a dictionary with:
    - total: Total number of jobs
    - by_state: Count of jobs by state
    - stale: Count of stale jobs
    - oldest_by_state: Age in hours of oldest job by state
    """
    now = time.time()

    async with _get_connection() as conn:
        # Get counts by state
        state_counts = await conn.fetch(
            """
            SELECT state, COUNT(*) as count
            FROM rag_jobs
            GROUP BY state
            """
        )

        # Get oldest job per state
        oldest_jobs = await conn.fetch(
            """
            SELECT state, MIN(updated_at) as oldest_updated_at
            FROM rag_jobs
            GROUP BY state
            """
        )

        # Count stale jobs
        stale_count = await conn.fetchval(
            """
            SELECT COUNT(*) FROM rag_jobs
            WHERE (state = 'completed' AND $1 - updated_at > $2 * 3600)
               OR (state = 'failed' AND $1 - updated_at > $3 * 3600)
               OR (state IN ('queued', 'running') AND $1 - updated_at > $4 * 3600)
            """,
            now,
            settings.job_completed_ttl_hours,
            settings.job_failed_ttl_hours,
            settings.job_orphaned_ttl_hours,
        )

    by_state: dict[str, int] = {
        JobState.QUEUED.value: 0,
        JobState.RUNNING.value: 0,
        JobState.COMPLETED.value: 0,
        JobState.FAILED.value: 0,
    }
    for row in state_counts:
        by_state[row["state"]] = row["count"]

    oldest_by_state: dict[str, float | None] = {
        JobState.QUEUED.value: None,
        JobState.RUNNING.value: None,
        JobState.COMPLETED.value: None,
        JobState.FAILED.value: None,
    }
    for row in oldest_jobs:
        if row["oldest_updated_at"] is not None:
            age_hours = (now - row["oldest_updated_at"]) / 3600
            oldest_by_state[row["state"]] = round(age_hours, 2)

    return {
        "total": sum(by_state.values()),
        "by_state": by_state,
        "stale": stale_count or 0,
        "oldest_by_state": oldest_by_state,
    }


async def cleanup_stale_jobs(
    *,
    completed_ttl_hours: float | None = None,
    failed_ttl_hours: float | None = None,
    orphaned_ttl_hours: float | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Clean up stale jobs based on TTL settings.

    Args:
        completed_ttl_hours: TTL for completed jobs (uses config default if None)
        failed_ttl_hours: TTL for failed jobs (uses config default if None)
        orphaned_ttl_hours: TTL for orphaned running/queued jobs (uses config default if None)
        dry_run: If True, only report what would be deleted without deleting

    Returns a dictionary with:
    - scanned: Total number of jobs scanned
    - deleted: Number of jobs deleted (or would be deleted if dry_run)
    - by_reason: Count of deletions by reason
    - deleted_jobs: List of deleted job IDs with reasons
    """
    ttl_completed = completed_ttl_hours if completed_ttl_hours is not None else settings.job_completed_ttl_hours
    ttl_failed = failed_ttl_hours if failed_ttl_hours is not None else settings.job_failed_ttl_hours
    ttl_orphaned = orphaned_ttl_hours if orphaned_ttl_hours is not None else settings.job_orphaned_ttl_hours

    now = time.time()

    async with _get_connection() as conn:
        # Find stale jobs
        stale_jobs = await conn.fetch(
            """
            SELECT job_id, state, $1 - updated_at as age_seconds
            FROM rag_jobs
            WHERE (state = 'completed' AND $1 - updated_at > $2 * 3600)
               OR (state = 'failed' AND $1 - updated_at > $3 * 3600)
               OR (state IN ('queued', 'running') AND $1 - updated_at > $4 * 3600)
            """,
            now,
            ttl_completed,
            ttl_failed,
            ttl_orphaned,
        )

        total_count = await conn.fetchval("SELECT COUNT(*) FROM rag_jobs")

        deleted_jobs: list[dict[str, Any]] = []
        by_reason: dict[str, int] = {
            "completed_expired": 0,
            "failed_expired": 0,
            "orphaned": 0,
        }

        job_ids_to_delete: list[str] = []
        for row in stale_jobs:
            age_hours = row["age_seconds"] / 3600
            state = row["state"]

            if state == "completed":
                reason = "completed_expired"
            elif state == "failed":
                reason = "failed_expired"
            else:
                reason = "orphaned"

            by_reason[reason] += 1
            deleted_jobs.append(
                {
                    "job_id": row["job_id"],
                    "reason": reason,
                    "age_hours": round(age_hours, 2),
                }
            )
            job_ids_to_delete.append(row["job_id"])

        if not dry_run and job_ids_to_delete:
            await conn.execute(
                "DELETE FROM rag_jobs WHERE job_id = ANY($1)",
                job_ids_to_delete,
            )

    return {
        "scanned": total_count or 0,
        "deleted": len(deleted_jobs),
        "by_reason": by_reason,
        "deleted_jobs": deleted_jobs,
        "dry_run": dry_run,
    }

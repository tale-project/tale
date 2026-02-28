"""PostgreSQL-based job status storage for ingestion jobs.

Uses the RAG service's shared connection pool (private_knowledge schema).
The rag_jobs table is created by the database init script; init_job_store()
ensures it exists as a safety net.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import asyncpg
from loguru import logger
from tale_shared.db import acquire_with_retry

from ..config import settings
from ..models import JobState, JobStatus
from .database import SCHEMA, get_pool

TABLE = f"{SCHEMA}.rag_jobs"


def _now() -> datetime:
    return datetime.now(UTC)


async def init_job_store() -> None:
    """Ensure the rag_jobs table exists (safety net — normally created by init script)."""
    pool = await get_pool()
    async with acquire_with_retry(pool) as conn:
        await conn.execute(f"""
            CREATE TABLE IF NOT EXISTS {TABLE} (
                job_id TEXT PRIMARY KEY,
                document_id TEXT,
                state TEXT NOT NULL DEFAULT 'queued',
                chunks_created INTEGER NOT NULL DEFAULT 0,
                message TEXT,
                error TEXT,
                skipped BOOLEAN NOT NULL DEFAULT FALSE,
                skip_reason TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        await conn.execute(f"""
            CREATE INDEX IF NOT EXISTS idx_pk_jobs_state ON {TABLE}(state)
        """)
        await conn.execute(f"""
            CREATE INDEX IF NOT EXISTS idx_pk_jobs_updated ON {TABLE}(updated_at)
        """)
        await conn.execute(f"""
            CREATE INDEX IF NOT EXISTS idx_pk_jobs_docid ON {TABLE}(document_id)
        """)
        logger.info("Job store table verified")


def _row_to_job_status(row: asyncpg.Record) -> JobStatus:
    """Convert a database row to JobStatus model."""
    created = row["created_at"]
    updated = row["updated_at"]
    return JobStatus(
        job_id=row["job_id"],
        document_id=row["document_id"],
        state=JobState(row["state"]),
        chunks_created=row["chunks_created"],
        message=row["message"],
        error=row["error"],
        skipped=row["skipped"],
        skip_reason=row["skip_reason"],
        created_at=created.timestamp() if isinstance(created, datetime) else created,
        updated_at=updated.timestamp() if isinstance(updated, datetime) else updated,
    )


async def get_job(job_id: str) -> JobStatus | None:
    """Load job status from database.

    Returns None if no job with this id exists.
    """
    pool = await get_pool()
    async with acquire_with_retry(pool) as conn:
        row = await conn.fetchrow(
            f"SELECT * FROM {TABLE} WHERE job_id = $1",
            job_id,
        )
        if row is None:
            return None
        return _row_to_job_status(row)


async def create_queued(job_id: str, document_id: str | None) -> JobStatus:
    """Create an initial queued job record.

    If a job with this ID already exists, it will be replaced.
    """
    now = _now()
    status = JobStatus(
        job_id=job_id,
        document_id=document_id,
        state=JobState.QUEUED,
        chunks_created=0,
        message="Queued for ingestion",
        error=None,
        skipped=False,
        skip_reason=None,
        created_at=now.timestamp(),
        updated_at=now.timestamp(),
    )

    pool = await get_pool()
    async with acquire_with_retry(pool) as conn:
        await conn.execute(
            f"""
            INSERT INTO {TABLE} (
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
            now,
            now,
        )

    return status


async def mark_running(job_id: str) -> None:
    """Mark a job as running.

    If the job does not exist yet, creates a minimal record.
    """
    now = _now()

    pool = await get_pool()
    async with acquire_with_retry(pool) as conn:
        result = await conn.execute(
            f"""
            UPDATE {TABLE}
            SET state = $1, message = $2, error = NULL, updated_at = $3
            WHERE job_id = $4 AND state = 'queued'
            """,
            JobState.RUNNING.value,
            "Ingestion started",
            now,
            job_id,
        )

        if result == "UPDATE 0":
            logger.warning("Job {} not found in queued state, creating fallback record", job_id)
            await conn.execute(
                f"""
                INSERT INTO {TABLE} (
                    job_id, document_id, state, chunks_created, message,
                    error, skipped, skip_reason, created_at, updated_at
                )
                VALUES ($1, NULL, $2, 0, $3, NULL, FALSE, NULL, $4, $5)
                ON CONFLICT (job_id) DO UPDATE SET
                    state = EXCLUDED.state, message = EXCLUDED.message, updated_at = EXCLUDED.updated_at
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
    """Mark a job as completed successfully."""
    now = _now()
    message = "Ingestion skipped (content unchanged)" if skipped else "Ingestion completed"

    pool = await get_pool()
    async with acquire_with_retry(pool) as conn:
        result = await conn.execute(
            f"""
            UPDATE {TABLE}
            SET state = $1, document_id = COALESCE($2, document_id), chunks_created = $3,
                message = $4, error = NULL, skipped = $5, skip_reason = $6, updated_at = $7
            WHERE job_id = $8 AND state = 'running'
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
            logger.warning("Job {} not found in running state, creating fallback record", job_id)
            await conn.execute(
                f"""
                INSERT INTO {TABLE} (
                    job_id, document_id, state, chunks_created, message,
                    error, skipped, skip_reason, created_at, updated_at
                )
                VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8, $9)
                ON CONFLICT (job_id) DO UPDATE SET
                    state = EXCLUDED.state, document_id = COALESCE(EXCLUDED.document_id, {TABLE}.document_id),
                    chunks_created = EXCLUDED.chunks_created, message = EXCLUDED.message,
                    skipped = EXCLUDED.skipped, skip_reason = EXCLUDED.skip_reason, updated_at = EXCLUDED.updated_at
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
    now = _now()

    pool = await get_pool()
    async with acquire_with_retry(pool) as conn:
        result = await conn.execute(
            f"""
            UPDATE {TABLE}
            SET state = $1, message = $2, error = $3, updated_at = $4
            WHERE job_id = $5 AND state IN ('queued', 'running')
            """,
            JobState.FAILED.value,
            "Ingestion failed",
            error,
            now,
            job_id,
        )

        if result == "UPDATE 0":
            logger.warning("Job {} not found in expected state, creating fallback record", job_id)
            await conn.execute(
                f"""
                INSERT INTO {TABLE} (
                    job_id, document_id, state, chunks_created, message,
                    error, skipped, skip_reason, created_at, updated_at
                )
                VALUES ($1, NULL, $2, 0, $3, $4, FALSE, NULL, $5, $6)
                ON CONFLICT (job_id) DO UPDATE SET
                    state = EXCLUDED.state, message = EXCLUDED.message,
                    error = EXCLUDED.error, updated_at = EXCLUDED.updated_at
                """,
                job_id,
                JobState.FAILED.value,
                "Ingestion failed",
                error,
                now,
                now,
            )


async def get_jobs_batch(job_ids: list[str]) -> dict[str, JobStatus | None]:
    """Load multiple job statuses from database."""
    if not job_ids:
        return {}

    pool = await get_pool()
    async with acquire_with_retry(pool) as conn:
        rows = await conn.fetch(
            f"SELECT * FROM {TABLE} WHERE job_id = ANY($1)",
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
    """List job statuses from database."""
    pool = await get_pool()
    async with acquire_with_retry(pool) as conn:
        if state is not None:
            rows = await conn.fetch(
                f"""
                SELECT * FROM {TABLE}
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
                f"""
                SELECT * FROM {TABLE}
                ORDER BY updated_at DESC
                LIMIT $1 OFFSET $2
                """,
                limit,
                offset,
            )

    return [_row_to_job_status(row) for row in rows]


async def delete_job(job_id: str) -> bool:
    """Delete a single job from database."""
    pool = await get_pool()
    async with acquire_with_retry(pool) as conn:
        result = await conn.execute(
            f"DELETE FROM {TABLE} WHERE job_id = $1",
            job_id,
        )
        return result == "DELETE 1"


async def clear_all_jobs() -> int:
    """Delete all job records from database."""
    pool = await get_pool()
    async with acquire_with_retry(pool) as conn:
        result = await conn.execute(f"DELETE FROM {TABLE}")
        try:
            return int(result.split()[-1])
        except (IndexError, ValueError):
            return 0


async def get_job_stats() -> dict[str, Any]:
    """Get statistics about jobs."""
    pool = await get_pool()
    async with acquire_with_retry(pool) as conn:
        state_counts = await conn.fetch(
            f"""
            SELECT state, COUNT(*) as count
            FROM {TABLE}
            GROUP BY state
            """
        )

        oldest_jobs = await conn.fetch(
            f"""
            SELECT state, MIN(updated_at) as oldest_updated_at
            FROM {TABLE}
            GROUP BY state
            """
        )

        stale_count = await conn.fetchval(
            f"""
            SELECT COUNT(*) FROM {TABLE}
            WHERE (state = 'completed' AND NOW() - updated_at > make_interval(hours => $1))
               OR (state = 'failed' AND NOW() - updated_at > make_interval(hours => $2))
               OR (state IN ('queued', 'running') AND NOW() - updated_at > make_interval(hours => $3))
            """,
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

    now = _now()
    oldest_by_state: dict[str, float | None] = {
        JobState.QUEUED.value: None,
        JobState.RUNNING.value: None,
        JobState.COMPLETED.value: None,
        JobState.FAILED.value: None,
    }
    for row in oldest_jobs:
        oldest = row["oldest_updated_at"]
        if oldest is not None:
            age_hours = (now - oldest).total_seconds() / 3600
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
    """Clean up stale jobs based on TTL settings."""
    ttl_completed = completed_ttl_hours if completed_ttl_hours is not None else settings.job_completed_ttl_hours
    ttl_failed = failed_ttl_hours if failed_ttl_hours is not None else settings.job_failed_ttl_hours
    ttl_orphaned = orphaned_ttl_hours if orphaned_ttl_hours is not None else settings.job_orphaned_ttl_hours

    pool = await get_pool()
    async with acquire_with_retry(pool) as conn:
        stale_jobs = await conn.fetch(
            f"""
            SELECT job_id, state, EXTRACT(EPOCH FROM NOW() - updated_at) as age_seconds
            FROM {TABLE}
            WHERE (state = 'completed' AND NOW() - updated_at > make_interval(hours => $1))
               OR (state = 'failed' AND NOW() - updated_at > make_interval(hours => $2))
               OR (state IN ('queued', 'running') AND NOW() - updated_at > make_interval(hours => $3))
            """,
            ttl_completed,
            ttl_failed,
            ttl_orphaned,
        )

        total_count = await conn.fetchval(f"SELECT COUNT(*) FROM {TABLE}")

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
                f"DELETE FROM {TABLE} WHERE job_id = ANY($1)",
                job_ids_to_delete,
            )

    return {
        "scanned": total_count or 0,
        "deleted": len(deleted_jobs),
        "by_reason": by_reason,
        "deleted_jobs": deleted_jobs,
        "dry_run": dry_run,
    }

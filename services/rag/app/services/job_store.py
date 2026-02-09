"""Simple job status storage for ingestion jobs.

This module tracks ingestion jobs by job_id using small JSON files on disk
under the configured cognee data directory. It is intentionally simple and
has best-effort concurrency via a process-local lock.

We keep the implementation self-contained so it can be used from FastAPI
endpoints without depending on FastAPI itself.
"""

from __future__ import annotations

import json
import os
import threading
import time
from typing import Any

from loguru import logger

from ..config import settings
from ..models import JobState, JobStatus

# Directory where job status JSON files are stored
_JOBS_DIR = os.path.join(settings.cognee_data_dir, "jobs")
os.makedirs(_JOBS_DIR, exist_ok=True)

# Process-local lock to avoid interleaved writes from concurrent requests
_LOCK = threading.Lock()


def _job_path(job_id: str) -> str:
    """Return the absolute path for a job status file."""
    # job_id comes from our own ID generators (doc-*/file-*), so it should
    # be safe as a filename; we still strip path separators for safety.
    safe_id = job_id.replace("/", "_").replace("\\", "_")
    return os.path.join(_JOBS_DIR, f"{safe_id}.json")


def get_job(job_id: str) -> JobStatus | None:
    """Load job status from disk.

    Returns None if no job with this id exists.
    """
    path = _job_path(job_id)
    if not os.path.exists(path):
        return None

    with _LOCK:
        try:
            with open(path, encoding="utf-8") as f:
                data: dict[str, Any] = json.load(f)
            return JobStatus(**data)
        except Exception:
            # Corrupted job file: treat as missing
            return None


def _write_job(status: JobStatus) -> None:
    """Persist a JobStatus to disk."""
    path = _job_path(status.job_id)
    payload = status.model_dump()
    with _LOCK, open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f)


def create_queued(job_id: str, document_id: str | None) -> JobStatus:
    """Create an initial queued job record.

    If a job file already exists, it will be overwritten with a fresh
    `queued` record so callers always get a clean view when reusing IDs.
    """
    now = time.time()
    status = JobStatus(
        job_id=job_id,
        document_id=document_id,
        state=JobState.QUEUED,
        chunks_created=0,
        message="Queued for ingestion",
        error=None,
        created_at=now,
        updated_at=now,
    )
    _write_job(status)
    return status


def mark_running(job_id: str) -> None:
    """Mark a job as running.

    If the job does not exist yet, we create a minimal record.
    """
    status = get_job(job_id)
    now = time.time()
    if status is None:
        status = JobStatus(
            job_id=job_id,
            document_id=None,
            state=JobState.RUNNING,
            chunks_created=0,
            message="Ingestion started",
            error=None,
            created_at=now,
            updated_at=now,
        )
    else:
        status.state = JobState.RUNNING
        status.message = "Ingestion started"
        status.error = None
        status.updated_at = now

    _write_job(status)


def mark_completed(
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
    status = get_job(job_id)
    now = time.time()

    message = "Ingestion skipped (content unchanged)" if skipped else "Ingestion completed"

    if status is None:
        status = JobStatus(
            job_id=job_id,
            document_id=document_id,
            state=JobState.COMPLETED,
            chunks_created=chunks_created,
            message=message,
            error=None,
            skipped=skipped,
            skip_reason=skip_reason,
            created_at=now,
            updated_at=now,
        )
    else:
        status.state = JobState.COMPLETED
        status.document_id = document_id or status.document_id
        status.chunks_created = chunks_created
        status.message = message
        status.error = None
        status.skipped = skipped
        status.skip_reason = skip_reason
        status.updated_at = now

    _write_job(status)


def mark_failed(job_id: str, *, error: str) -> None:
    """Mark a job as failed with the given error message."""
    status = get_job(job_id)
    now = time.time()
    if status is None:
        status = JobStatus(
            job_id=job_id,
            document_id=None,
            state=JobState.FAILED,
            chunks_created=0,
            message="Ingestion failed",
            error=error,
            created_at=now,
            updated_at=now,
        )
    else:
        status.state = JobState.FAILED
        status.message = "Ingestion failed"
        status.error = error
        status.updated_at = now

    _write_job(status)


def get_jobs_batch(job_ids: list[str]) -> dict[str, JobStatus | None]:
    """Load multiple job statuses from disk.

    Returns a dictionary mapping job_id to JobStatus (or None if not found).
    This is a convenience wrapper that iterates over job_ids and calls get_job()
    for each one. It provides a simpler API for batch status retrieval.
    """
    result: dict[str, JobStatus | None] = {}
    for job_id in job_ids:
        result[job_id] = get_job(job_id)
    return result


def clear_all_jobs() -> int:
    """Delete all job status files from disk.

    Returns the number of job files deleted.
    """
    count = 0
    with _LOCK:
        for filename in os.listdir(_JOBS_DIR):
            if filename.endswith(".json"):
                try:
                    os.remove(os.path.join(_JOBS_DIR, filename))
                    count += 1
                except OSError:
                    pass
    return count


def list_all_jobs() -> list[JobStatus]:
    """List all job statuses from disk.

    Returns a list of all JobStatus objects. Corrupted job files are skipped.
    """
    jobs: list[JobStatus] = []
    with _LOCK:
        try:
            filenames = os.listdir(_JOBS_DIR)
        except OSError:
            return jobs

        for filename in filenames:
            if not filename.endswith(".json"):
                continue
            path = os.path.join(_JOBS_DIR, filename)
            try:
                with open(path, encoding="utf-8") as f:
                    data: dict[str, Any] = json.load(f)
                jobs.append(JobStatus(**data))
            except Exception:
                # Skip corrupted job files but log for debugging
                logger.debug(f"Skipping corrupted job file: {filename}")
    return jobs


def delete_job(job_id: str) -> bool:
    """Delete a single job status file from disk.

    Returns True if the job was deleted, False if it did not exist.
    """
    path = _job_path(job_id)
    with _LOCK:
        try:
            os.remove(path)
            return True
        except FileNotFoundError:
            return False
        except OSError as e:
            logger.warning(f"Failed to delete job file {job_id}: {e}")
            return False


def get_job_stats() -> dict[str, Any]:
    """Get statistics about jobs.

    Returns a dictionary with:
    - total: Total number of jobs
    - by_state: Count of jobs by state
    - stale: Count of stale jobs (jobs that would be cleaned up with default TTLs)
    - oldest_by_state: Age in hours of oldest job by state
    """
    now = time.time()
    jobs = list_all_jobs()

    by_state: dict[str, int] = {
        JobState.QUEUED.value: 0,
        JobState.RUNNING.value: 0,
        JobState.COMPLETED.value: 0,
        JobState.FAILED.value: 0,
    }
    oldest_by_state: dict[str, float | None] = {
        JobState.QUEUED.value: None,
        JobState.RUNNING.value: None,
        JobState.COMPLETED.value: None,
        JobState.FAILED.value: None,
    }
    stale_count = 0

    for job in jobs:
        state_key = job.state.value
        by_state[state_key] += 1

        age_hours = (now - job.updated_at) / 3600
        current_oldest = oldest_by_state[state_key]
        if current_oldest is None or age_hours > current_oldest:
            oldest_by_state[state_key] = round(age_hours, 2)

        # Check if stale using default TTLs
        if (
            (job.state == JobState.COMPLETED and age_hours > settings.job_completed_ttl_hours)
            or (job.state == JobState.FAILED and age_hours > settings.job_failed_ttl_hours)
            or (job.state in (JobState.QUEUED, JobState.RUNNING) and age_hours > settings.job_orphaned_ttl_hours)
        ):
            stale_count += 1

    return {
        "total": len(jobs),
        "by_state": by_state,
        "stale": stale_count,
        "oldest_by_state": oldest_by_state,
    }


def cleanup_stale_jobs(
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
    - by_reason: Count of deletions by reason (completed_expired, failed_expired, orphaned)
    - deleted_jobs: List of deleted job IDs with reasons
    """
    ttl_completed = completed_ttl_hours if completed_ttl_hours is not None else settings.job_completed_ttl_hours
    ttl_failed = failed_ttl_hours if failed_ttl_hours is not None else settings.job_failed_ttl_hours
    ttl_orphaned = orphaned_ttl_hours if orphaned_ttl_hours is not None else settings.job_orphaned_ttl_hours

    now = time.time()
    jobs = list_all_jobs()

    deleted_jobs: list[dict[str, Any]] = []
    by_reason: dict[str, int] = {
        "completed_expired": 0,
        "failed_expired": 0,
        "orphaned": 0,
    }

    for job in jobs:
        age_hours = (now - job.updated_at) / 3600
        reason: str | None = None

        if job.state == JobState.COMPLETED and age_hours > ttl_completed:
            reason = "completed_expired"
        elif job.state == JobState.FAILED and age_hours > ttl_failed:
            reason = "failed_expired"
        elif job.state in (JobState.QUEUED, JobState.RUNNING) and age_hours > ttl_orphaned:
            reason = "orphaned"

        if reason:
            by_reason[reason] += 1
            deleted_jobs.append({"job_id": job.job_id, "reason": reason, "age_hours": round(age_hours, 2)})
            if not dry_run:
                delete_job(job.job_id)

    return {
        "scanned": len(jobs),
        "deleted": len(deleted_jobs),
        "by_reason": by_reason,
        "deleted_jobs": deleted_jobs,
        "dry_run": dry_run,
    }

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
from typing import Any, Dict, Optional

from ..config import settings
from ..models import JobStatus, JobState


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


def get_job(job_id: str) -> Optional[JobStatus]:
    """Load job status from disk.

    Returns None if no job with this id exists.
    """
    path = _job_path(job_id)
    if not os.path.exists(path):
        return None

    with _LOCK:
        try:
            with open(path, "r", encoding="utf-8") as f:
                data: Dict[str, Any] = json.load(f)
            return JobStatus(**data)
        except Exception:
            # Corrupted job file: treat as missing
            return None


def _write_job(status: JobStatus) -> None:
    """Persist a JobStatus to disk."""
    path = _job_path(status.job_id)
    payload = status.model_dump()
    with _LOCK:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f)


def create_queued(job_id: str, document_id: Optional[str]) -> JobStatus:
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


def mark_completed(job_id: str, *, document_id: Optional[str], chunks_created: int) -> None:
    """Mark a job as completed successfully."""
    status = get_job(job_id)
    now = time.time()
    if status is None:
        status = JobStatus(
            job_id=job_id,
            document_id=document_id,
            state=JobState.COMPLETED,
            chunks_created=chunks_created,
            message="Ingestion completed",
            error=None,
            created_at=now,
            updated_at=now,
        )
    else:
        status.state = JobState.COMPLETED
        status.document_id = document_id or status.document_id
        status.chunks_created = chunks_created
        status.message = "Ingestion completed"
        status.error = None
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


def get_jobs_batch(job_ids: list[str]) -> Dict[str, Optional[JobStatus]]:
    """Load multiple job statuses from disk in a batch.

    Returns a dictionary mapping job_id to JobStatus (or None if not found).
    This is more efficient than calling get_job() for each job_id individually.
    """
    result: Dict[str, Optional[JobStatus]] = {}
    for job_id in job_ids:
        result[job_id] = get_job(job_id)
    return result


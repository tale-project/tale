"""Job status endpoints for Tale RAG service."""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from ..models import JobStatus
from ..services import job_store

router = APIRouter(prefix="/api/v1", tags=["Jobs"])

# Thread pool for running blocking I/O operations without blocking the event loop
_executor = ThreadPoolExecutor(max_workers=4)

# Maximum number of job IDs allowed in a single batch request
MAX_BATCH_SIZE = 100


class BatchJobsRequest(BaseModel):
    """Request to get multiple job statuses at once."""

    job_ids: list[str] = Field(
        ...,
        description="List of job IDs to query",
        max_length=MAX_BATCH_SIZE,
    )


class BatchJobsResponse(BaseModel):
    """Response containing multiple job statuses."""

    jobs: dict[str, JobStatus | None] = Field(
        ...,
        description="Map of job_id to JobStatus (null if job not found)",
    )


class JobStatsResponse(BaseModel):
    """Response containing job statistics."""

    total: int = Field(..., description="Total number of jobs")
    by_state: dict[str, int] = Field(
        ..., description="Count of jobs by state (queued, running, completed, failed)"
    )
    stale: int = Field(
        ..., description="Number of stale jobs that would be cleaned up with default TTLs"
    )
    oldest_by_state: dict[str, float | None] = Field(
        ..., description="Age in hours of the oldest job for each state (null if no jobs in that state)"
    )


class CleanupRequest(BaseModel):
    """Request to trigger job cleanup."""

    completed_ttl_hours: float | None = Field(
        default=None,
        description="TTL in hours for completed jobs (uses default if not specified)",
        ge=0,
    )
    failed_ttl_hours: float | None = Field(
        default=None,
        description="TTL in hours for failed jobs (uses default if not specified)",
        ge=0,
    )
    orphaned_ttl_hours: float | None = Field(
        default=None,
        description="TTL in hours for orphaned jobs (uses default if not specified)",
        ge=0,
    )
    dry_run: bool = Field(
        default=False,
        description="If true, only report what would be deleted without actually deleting",
    )


class DeletedJobInfo(BaseModel):
    """Information about a deleted job."""

    job_id: str = Field(..., description="ID of the deleted job")
    reason: str = Field(
        ..., description="Reason for deletion (completed_expired, failed_expired, orphaned)"
    )
    age_hours: float = Field(..., description="Age of the job in hours when deleted")


class CleanupResponse(BaseModel):
    """Response from job cleanup operation."""

    scanned: int = Field(..., description="Total number of jobs scanned")
    deleted: int = Field(..., description="Number of jobs deleted (or would be deleted if dry_run)")
    by_reason: dict[str, int] = Field(
        ..., description="Count of deletions by reason"
    )
    deleted_jobs: list[DeletedJobInfo] = Field(
        ..., description="Details of deleted jobs"
    )
    dry_run: bool = Field(..., description="Whether this was a dry run")


@router.get("/jobs/stats", response_model=JobStatsResponse)
async def get_job_stats() -> JobStatsResponse:
    """Get statistics about all background ingestion jobs.

    Returns counts by state, the number of stale jobs that would be cleaned
    up with current TTL settings, and the age of the oldest job in each state.
    """
    loop = asyncio.get_running_loop()
    stats = await loop.run_in_executor(_executor, job_store.get_job_stats)
    return JobStatsResponse(**stats)


@router.post("/jobs/cleanup", response_model=CleanupResponse)
async def cleanup_jobs(request: CleanupRequest) -> CleanupResponse:
    """Manually trigger cleanup of stale jobs.

    This endpoint allows administrators to clean up jobs that have exceeded
    their TTL. Use dry_run=true to preview what would be deleted.

    TTL defaults:
    - completed: 24 hours
    - failed: 72 hours
    - orphaned (stuck running/queued): 6 hours
    """
    loop = asyncio.get_running_loop()

    def do_cleanup() -> dict[str, Any]:
        return job_store.cleanup_stale_jobs(
            completed_ttl_hours=request.completed_ttl_hours,
            failed_ttl_hours=request.failed_ttl_hours,
            orphaned_ttl_hours=request.orphaned_ttl_hours,
            dry_run=request.dry_run,
        )

    result = await loop.run_in_executor(_executor, do_cleanup)

    # Convert deleted_jobs dicts to DeletedJobInfo objects
    deleted_jobs = [DeletedJobInfo(**job) for job in result["deleted_jobs"]]

    return CleanupResponse(
        scanned=result["scanned"],
        deleted=result["deleted"],
        by_reason=result["by_reason"],
        deleted_jobs=deleted_jobs,
        dry_run=result["dry_run"],
    )


@router.post("/jobs/batch", response_model=BatchJobsResponse)
async def get_jobs_batch(request: BatchJobsRequest) -> BatchJobsResponse:
    """Get the status of multiple background ingestion jobs at once.

    This endpoint is more efficient than calling /jobs/{job_id} multiple times
    when you need to query many job statuses (e.g., for a document list page).

    Returns a map of job_id to JobStatus. If a job is not found, its value
    will be null in the response.
    """
    # Run the synchronous file I/O in a thread pool to avoid blocking the event loop
    loop = asyncio.get_running_loop()
    jobs = await loop.run_in_executor(
        _executor, job_store.get_jobs_batch, request.job_ids
    )
    return BatchJobsResponse(jobs=jobs)


@router.get("/jobs/{job_id}", response_model=JobStatus)
async def get_job_status(job_id: str) -> JobStatus:
    """Get the status of a background ingestion job by job_id.

    This endpoint allows callers (including Convex workflows and UIs) to
    poll for progress or completion of asynchronous document ingestion.
    """
    # Run the synchronous file I/O in a thread pool to avoid blocking the event loop
    loop = asyncio.get_running_loop()
    status_obj = await loop.run_in_executor(_executor, job_store.get_job, job_id)
    if status_obj is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job not found",
        )
    return status_obj

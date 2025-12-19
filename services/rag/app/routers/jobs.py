"""Job status endpoints for Tale RAG service."""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

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

    jobs: dict[str, Optional[JobStatus]] = Field(
        ...,
        description="Map of job_id to JobStatus (null if job not found)",
    )


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


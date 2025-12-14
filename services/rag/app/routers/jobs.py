"""Job status endpoints for Tale RAG service."""

import asyncio
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, HTTPException, status

from ..models import JobStatus
from ..services import job_store

router = APIRouter(prefix="/api/v1", tags=["Jobs"])

# Thread pool for running blocking I/O operations without blocking the event loop
_executor = ThreadPoolExecutor(max_workers=4)


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


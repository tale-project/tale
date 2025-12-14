"""Job status endpoints for Tale RAG service."""

from fastapi import APIRouter, HTTPException, status

from ..models import JobStatus
from ..services import job_store

router = APIRouter(prefix="/api/v1", tags=["Jobs"])


@router.get("/jobs/{job_id}", response_model=JobStatus)
async def get_job_status(job_id: str) -> JobStatus:
    """Get the status of a background ingestion job by job_id.

    This endpoint allows callers (including Convex workflows and UIs) to
    poll for progress or completion of asynchronous document ingestion.
    """
    status_obj = job_store.get_job(job_id)
    if status_obj is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job not found",
        )
    return status_obj


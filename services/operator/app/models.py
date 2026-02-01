"""
Request and response models for the Operator service.
"""

from typing import Any

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    """Health check response."""

    status: str
    version: str
    browser_initialized: bool


class AnswerRequest(BaseModel):
    """Request for answering a question using web search."""

    question: str = Field(..., description="The question to answer")


class AnswerResponse(BaseModel):
    """Response with synthesized answer from web search."""

    success: bool
    question: str
    answer: str | None = None
    sources: list[str] = Field(default_factory=list, description="URLs of sources used")
    error: str | None = None


class TaskRequest(BaseModel):
    """Generic browser task request."""

    task: str = Field(..., description="Natural language task description")
    timeout: int = Field(default=60, ge=10, le=300, description="Task timeout in seconds")


class TaskResponse(BaseModel):
    """Generic browser task response."""

    success: bool
    task: str
    result: Any = None
    error: str | None = None

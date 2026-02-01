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


class SearchRequest(BaseModel):
    """Web search request."""

    query: str = Field(..., description="Search query")
    engine: str = Field(default="google", description="Search engine: google, bing, duckduckgo")
    num_results: int = Field(default=10, ge=1, le=50, description="Number of results to return")
    language: str = Field(default="en", description="Language code (e.g., zh-CN, en)")


class SearchResult(BaseModel):
    """Single search result."""

    position: int = Field(default=0, description="Position in search results (1-indexed)")
    title: str
    url: str
    snippet: str


class RichData(BaseModel):
    """Rich data extracted from search (e.g., exchange rates, weather)."""

    type: str
    data: dict[str, Any]


class SearchResponse(BaseModel):
    """Web search response."""

    success: bool
    query: str
    engine: str
    results: list[SearchResult]
    total_results: int = Field(default=0, description="Total number of results returned")
    captcha_detected: bool = Field(default=False, description="Whether CAPTCHA was detected")
    rich_data: RichData | None = None
    error: str | None = None


class AnswerRequest(BaseModel):
    """Request for answering a question using web search."""

    question: str = Field(..., description="The question to answer")
    language: str = Field(default="en", description="Language code for search (e.g., zh-CN, en)")


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

"""Pydantic models for Tale RAG API."""

from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


# ============================================================================
# Health & Status Models
# ============================================================================

class HealthResponse(BaseModel):
    """Health check response."""
    status: str = Field(..., description="Service health status")
    version: str = Field(..., description="Service version")
    cognee_initialized: bool = Field(..., description="Whether cognee is initialized")


class ConfigResponse(BaseModel):
    """Configuration response (non-sensitive values only)."""
    host: str
    port: int
    log_level: str
    openai_model: str
    openai_embedding_model: str
    chunk_size: int
    chunk_overlap: int
    top_k: int
    similarity_threshold: float
    enable_graph_storage: bool
    enable_vector_search: bool


# ============================================================================
# Document Management Models
# ============================================================================

class ContentType(str, Enum):
    """Content type for document addition (text only)."""
    TEXT = "text"


class DocumentAddRequest(BaseModel):
    """Request to add a text document to the knowledge base."""
    content: str = Field(..., description="Document content (plain text)")
    content_type: ContentType = Field(
        default=ContentType.TEXT,
        description="Type of content. Only 'text' is supported; URL ingestion via this endpoint has been removed.",
    )
    metadata: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Optional metadata for the document",
    )
    document_id: Optional[str] = Field(
        default=None,
        description="Optional custom document ID",
    )


class DocumentAddResponse(BaseModel):
    """Response after adding a document.

    The "success" field indicates whether the request was accepted and, for
    synchronous flows, whether ingestion completed without error. For
    asynchronous ingestion, "success" refers to the enqueue operation and
    "queued" will be set to True.
    """

    success: bool = Field(
        ..., description="Whether the operation (or enqueue) succeeded"
    )
    document_id: str = Field(..., description="ID of the added document")
    chunks_created: int = Field(
        ..., description="Number of chunks created (0 when queued)"
    )
    message: str = Field(..., description="Status message")
    queued: bool = Field(
        default=False,
        description="Whether ingestion was queued for background processing",
    )
    job_id: Optional[str] = Field(
        default=None,
        description="Background job identifier when ingestion is queued",
    )


class DocumentDeleteRequest(BaseModel):
    """Request to delete a document by ID (legacy, not fully supported)."""

    document_id: str = Field(..., description="ID of the document to delete")


class DocumentDeleteResponse(BaseModel):
    """Response after deleting a document."""

    success: bool = Field(..., description="Whether the operation succeeded")
    message: str = Field(..., description="Status message")
    deleted_count: int = Field(
        default=0,
        description="Number of documents deleted",
    )
    deleted_data_ids: List[str] = Field(
        default_factory=list,
        description="List of Cognee Data IDs that were deleted",
    )
    processing_time_ms: Optional[float] = Field(
        default=None,
        description="Processing time in milliseconds",
    )


# ============================================================================
# Job Status Models
# ============================================================================


class JobState(str, Enum):
    """State of a background ingestion job."""

    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class JobStatus(BaseModel):
    """Status of a background ingestion job.

    This is stored on disk as JSON and returned by the job status endpoint.
    """

    job_id: str = Field(..., description="Identifier for the background job")
    document_id: Optional[str] = Field(
        default=None,
        description="Associated document identifier, if known",
    )
    state: JobState = Field(..., description="Current job state")
    chunks_created: int = Field(
        default=0,
        description="Number of chunks created so far (final value when completed)",
    )
    message: Optional[str] = Field(
        default=None,
        description="Human-readable status message",
    )
    error: Optional[str] = Field(
        default=None,
        description="Error message when the job is in FAILED state",
    )
    created_at: float = Field(
        ..., description="Unix timestamp (seconds) when the job record was created",
    )
    updated_at: float = Field(
        ..., description="Unix timestamp (seconds) when the job record was last updated",
    )


# ============================================================================
# Query Models
# ============================================================================

class QueryRequest(BaseModel):
    """Request to query the knowledge base."""
    query: str = Field(..., description="Query text")
    top_k: Optional[int] = Field(
        default=None,
        description="Number of results to return (overrides default)"
    )
    similarity_threshold: Optional[float] = Field(
        default=None,
        description="Minimum similarity score (overrides default)"
    )
    include_metadata: bool = Field(
        default=True,
        description="Whether to include metadata in results"
    )
    filters: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Optional filters for metadata"
    )


class SearchResult(BaseModel):
    """A single search result."""
    content: str = Field(..., description="Content of the result")
    score: float = Field(..., description="Similarity score")
    document_id: Optional[str] = Field(
        default=None,
        description="Source document ID"
    )
    metadata: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Result metadata"
    )


class QueryResponse(BaseModel):
    """Response to a query."""
    success: bool = Field(..., description="Whether the query succeeded")
    query: str = Field(..., description="Original query")
    results: List[SearchResult] = Field(..., description="Search results")
    total_results: int = Field(..., description="Total number of results")
    processing_time_ms: float = Field(..., description="Query processing time in milliseconds")


# ============================================================================
# RAG Generation Models
# ============================================================================

class GenerateRequest(BaseModel):
    """Request to generate a response using RAG."""
    query: str = Field(..., description="User query")
    top_k: Optional[int] = Field(
        default=None,
        description="Number of context documents to retrieve"
    )
    system_prompt: Optional[str] = Field(
        default=None,
        description="Optional system prompt override"
    )
    temperature: Optional[float] = Field(
        default=None,
        description="LLM temperature (overrides default)"
    )
    max_tokens: Optional[int] = Field(
        default=None,
        description="Maximum tokens to generate (overrides default)"
    )


class GenerateResponse(BaseModel):
    """Response from RAG generation."""
    success: bool = Field(..., description="Whether generation succeeded")
    query: str = Field(..., description="Original query")
    response: str = Field(..., description="Generated response")
    sources: List[SearchResult] = Field(..., description="Source documents used")
    processing_time_ms: float = Field(..., description="Total processing time in milliseconds")


# ============================================================================
# Knowledge Graph Models
# ============================================================================

class GraphQueryRequest(BaseModel):
    """Request to query the knowledge graph."""
    query: str = Field(..., description="Graph query (Cypher or natural language)")
    query_type: str = Field(
        default="natural",
        description="Query type: 'natural' or 'cypher'"
    )


class GraphQueryResponse(BaseModel):
    """Response from knowledge graph query."""
    success: bool = Field(..., description="Whether the query succeeded")
    results: List[Dict[str, Any]] = Field(..., description="Query results")
    total_results: int = Field(..., description="Total number of results")


# ============================================================================
# Error Models
# ============================================================================

class ErrorResponse(BaseModel):
    """Error response."""
    error: str = Field(..., description="Error type")
    message: str = Field(..., description="Error message")
    details: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Additional error details"
    )


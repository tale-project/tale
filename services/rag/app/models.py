"""Pydantic models for Tale RAG API."""

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, model_validator

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
    metadata: dict[str, Any] | None = Field(
        default=None,
        description="Optional metadata for the document",
    )
    document_id: str | None = Field(
        default=None,
        description="Optional custom document ID",
    )
    # Multi-tenancy support
    # user_id and team_ids are mutually exclusive for upload:
    # - user_id provided → private document (team_ids ignored)
    # - team_ids only → shared team document
    user_id: str | None = Field(
        default=None,
        description="User ID for private document storage. If provided, document is stored "
                    "in user's private dataset (team_ids is ignored). At least one of user_id "
                    "or team_ids must be provided.",
    )
    team_ids: list[str] | None = Field(
        default=None,
        description="Team IDs for shared document storage. Document will be added to each "
                    "team's dataset (tale_team_{team_id}). Ignored if user_id is provided.",
    )

    @model_validator(mode="after")
    def validate_and_sanitize(self):
        """Validate that at least one of user_id or team_ids is provided,
        and sanitize team_ids if present.

        Team IDs are sanitized:
        - Spaces and dots are replaced with underscores
        - Only alphanumeric, underscore, and hyphen characters are allowed
        """
        # At least one of user_id or team_ids must be provided
        if not self.user_id and not self.team_ids:
            raise ValueError("At least one of user_id or team_ids must be provided")

        # Sanitize team_ids if provided
        if self.team_ids:
            from app.services.cognee.utils import sanitize_team_id

            sanitized_ids = [sanitize_team_id(tid) for tid in self.team_ids]
            sanitized_ids = [tid for tid in sanitized_ids if tid]

            if not sanitized_ids:
                raise ValueError("At least one valid team_id is required after sanitization")

            object.__setattr__(self, "team_ids", sanitized_ids)

        return self


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
    job_id: str | None = Field(
        default=None,
        description="Background job identifier when ingestion is queued",
    )
    cleaned_datasets: list[str] | None = Field(
        default=None,
        description="List of old datasets that were cleaned up during upload "
                    "(when document was moved to a different team/dataset)",
    )
    skipped: bool = Field(
        default=False,
        description="Whether ingestion was skipped due to content being unchanged",
    )
    skip_reason: str | None = Field(
        default=None,
        description="Reason for skipping ingestion (e.g., 'content_unchanged')",
    )


class DocumentDeleteRequest(BaseModel):
    """Request to delete a document by ID."""

    document_id: str = Field(..., description="ID of the document to delete")


class DocumentDeleteResponse(BaseModel):
    """Response after deleting a document."""

    success: bool = Field(..., description="Whether the operation succeeded")
    message: str = Field(..., description="Status message")
    deleted_count: int = Field(
        default=0,
        description="Number of documents deleted",
    )
    deleted_data_ids: list[str] = Field(
        default_factory=list,
        description="List of Cognee Data IDs that were deleted",
    )
    processing_time_ms: float | None = Field(
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
    document_id: str | None = Field(
        default=None,
        description="Associated document identifier, if known",
    )
    state: JobState = Field(..., description="Current job state")
    chunks_created: int = Field(
        default=0,
        description="Number of chunks created so far (final value when completed)",
    )
    message: str | None = Field(
        default=None,
        description="Human-readable status message",
    )
    error: str | None = Field(
        default=None,
        description="Error message when the job is in FAILED state",
    )
    skipped: bool = Field(
        default=False,
        description="Whether ingestion was skipped (e.g., content unchanged)",
    )
    skip_reason: str | None = Field(
        default=None,
        description="Reason for skipping ingestion (e.g., 'content_unchanged')",
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

class SearchType(str, Enum):
    """Search type for knowledge base queries.

    Available types (from Cognee 0.4.0):
    - CHUNKS: Return raw text chunks (best for detailed content retrieval)
    - GRAPH_COMPLETION: Use knowledge graph for reasoning
    - RAG_COMPLETION: Shorter answers based on chunks
    - SUMMARIES: Return document summaries only
    - GRAPH_SUMMARY_COMPLETION: Graph summary with completion
    - TEMPORAL: Time-aware search
    """
    CHUNKS = "CHUNKS"
    GRAPH_COMPLETION = "GRAPH_COMPLETION"
    RAG_COMPLETION = "RAG_COMPLETION"
    SUMMARIES = "SUMMARIES"
    GRAPH_SUMMARY_COMPLETION = "GRAPH_SUMMARY_COMPLETION"
    TEMPORAL = "TEMPORAL"


class QueryRequest(BaseModel):
    """Request to query the knowledge base."""
    query: str = Field(..., description="Query text")
    search_type: SearchType | None = Field(
        default=SearchType.CHUNKS,
        description="Type of search to perform. CHUNKS returns raw text passages (default), "
                    "GRAPH_COMPLETION uses knowledge graph reasoning, "
                    "RAG_COMPLETION provides shorter answers, "
                    "SUMMARIES returns document summaries."
    )
    top_k: int | None = Field(
        default=None,
        description="Number of results to return (overrides default)"
    )
    similarity_threshold: float | None = Field(
        default=None,
        description="Minimum similarity score (overrides default)"
    )
    include_metadata: bool = Field(
        default=True,
        description="Whether to include metadata in results"
    )
    filters: dict[str, Any] | None = Field(
        default=None,
        description="Optional filters for metadata"
    )
    # Multi-tenancy support
    # Search can include both user's private dataset and team datasets
    user_id: str | None = Field(
        default=None,
        description="User ID for searching user's private documents. If provided, user's "
                    "private dataset (tale_user_{uuid}) is included in search.",
    )
    team_ids: list[str] | None = Field(
        default=None,
        description="Team IDs for searching shared team documents. Each team's dataset "
                    "(tale_team_{team_id}) is included in search. At least one of user_id "
                    "or team_ids must be provided.",
    )

    @model_validator(mode="after")
    def validate_and_sanitize(self):
        """Validate that at least one of user_id or team_ids is provided,
        and sanitize team_ids if present."""
        # At least one of user_id or team_ids must be provided
        if not self.user_id and not self.team_ids:
            raise ValueError("At least one of user_id or team_ids must be provided")

        # Sanitize team_ids if provided
        if self.team_ids:
            from app.services.cognee.utils import sanitize_team_id

            sanitized_ids = [sanitize_team_id(tid) for tid in self.team_ids]
            sanitized_ids = [tid for tid in sanitized_ids if tid]

            if not sanitized_ids:
                raise ValueError("At least one valid team_id is required after sanitization")

            object.__setattr__(self, "team_ids", sanitized_ids)
        return self


class SearchResult(BaseModel):
    """A single search result."""
    content: str = Field(..., description="Content of the result")
    score: float = Field(..., description="Similarity score")
    document_id: str | None = Field(
        default=None,
        description="Source document ID"
    )
    metadata: dict[str, Any] | None = Field(
        default=None,
        description="Result metadata"
    )


class QueryResponse(BaseModel):
    """Response to a query."""
    success: bool = Field(..., description="Whether the query succeeded")
    query: str = Field(..., description="Original query")
    results: list[SearchResult] = Field(..., description="Search results")
    total_results: int = Field(..., description="Total number of results")
    processing_time_ms: float = Field(..., description="Query processing time in milliseconds")


# ============================================================================
# RAG Generation Models
# ============================================================================

class GenerateRequest(BaseModel):
    """Request to generate a response using RAG."""
    query: str = Field(..., description="User query")
    top_k: int | None = Field(
        default=None,
        description="Number of context documents to retrieve"
    )
    system_prompt: str | None = Field(
        default=None,
        description="Optional system prompt override"
    )
    temperature: float | None = Field(
        default=None,
        description="LLM temperature (overrides default)"
    )
    max_tokens: int | None = Field(
        default=None,
        description="Maximum tokens to generate (overrides default)"
    )
    # Multi-tenancy support
    # Generate can include both user's private dataset and team datasets
    user_id: str | None = Field(
        default=None,
        description="User ID for retrieving user's private documents as context.",
    )
    team_ids: list[str] | None = Field(
        default=None,
        description="Team IDs to retrieve context from. At least one of user_id "
                    "or team_ids must be provided.",
    )

    @model_validator(mode="after")
    def validate_and_sanitize(self):
        """Validate that at least one of user_id or team_ids is provided,
        and sanitize team_ids if present."""
        # At least one of user_id or team_ids must be provided
        if not self.user_id and not self.team_ids:
            raise ValueError("At least one of user_id or team_ids must be provided")

        # Sanitize team_ids if provided
        if self.team_ids:
            from app.services.cognee.utils import sanitize_team_id

            sanitized_ids = [sanitize_team_id(tid) for tid in self.team_ids]
            sanitized_ids = [tid for tid in sanitized_ids if tid]

            if not sanitized_ids:
                raise ValueError("At least one valid team_id is required after sanitization")

            object.__setattr__(self, "team_ids", sanitized_ids)
        return self


class GenerateResponse(BaseModel):
    """Response from RAG generation."""
    success: bool = Field(..., description="Whether generation succeeded")
    query: str = Field(..., description="Original query")
    response: str = Field(..., description="Generated response")
    sources: list[SearchResult] = Field(..., description="Source documents used")
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
    results: list[dict[str, Any]] = Field(..., description="Query results")
    total_results: int = Field(..., description="Total number of results")


# ============================================================================
# Error Models
# ============================================================================

class ErrorResponse(BaseModel):
    """Error response."""
    error: str = Field(..., description="Error type")
    message: str = Field(..., description="Error message")
    details: dict[str, Any] | None = Field(
        default=None,
        description="Additional error details"
    )


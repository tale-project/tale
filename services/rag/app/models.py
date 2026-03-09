"""Pydantic models for Tale RAG API."""

from typing import Any, Literal

from pydantic import BaseModel, Field

# ============================================================================
# Health & Status Models
# ============================================================================


class HealthResponse(BaseModel):
    """Health check response."""

    status: str = Field(..., description="Service health status")
    version: str = Field(..., description="Service version")
    initialized: bool = Field(..., description="Whether the RAG service is initialized")


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


# ============================================================================
# Document Management Models
# ============================================================================


class DocumentAddResponse(BaseModel):
    """Response after adding a document.

    The "success" field indicates whether the request was accepted and, for
    synchronous flows, whether ingestion completed without error. For
    asynchronous ingestion, "success" refers to the enqueue operation and
    "queued" will be set to True.
    """

    success: bool = Field(..., description="Whether the operation (or enqueue) succeeded")
    document_id: str = Field(..., description="ID of the added document")
    chunks_created: int = Field(..., description="Number of chunks created (0 when queued)")
    message: str = Field(..., description="Status message")
    queued: bool = Field(
        default=False,
        description="Whether ingestion was queued for background processing",
    )
    skipped: bool = Field(
        default=False,
        description="Whether ingestion was skipped due to content being unchanged",
    )
    skip_reason: str | None = Field(
        default=None,
        description="Reason for skipping ingestion (e.g., 'content_unchanged')",
    )


class ChunkRange(BaseModel):
    """Range of chunks returned in a content response."""

    start: int = Field(..., description="First chunk returned (1-indexed)")
    end: int = Field(..., description="Last chunk returned (1-indexed, inclusive)")


class DocumentChunk(BaseModel):
    """A single document chunk."""

    index: int = Field(..., description="Chunk index (1-indexed)")
    content: str = Field(..., description="Chunk text content")


class DocumentContentResponse(BaseModel):
    """Response containing reassembled document content."""

    document_id: str = Field(..., description="Document identifier")
    title: str | None = Field(default=None, description="Original filename")
    content: str = Field(..., description="Reassembled text content")
    chunk_range: ChunkRange = Field(..., description="Range of chunks returned (1-indexed, inclusive)")
    total_chunks: int = Field(..., description="Total number of chunks in the document")
    total_chars: int = Field(..., description="Total character count of returned content")
    chunks: list[DocumentChunk] | None = Field(
        default=None,
        description="Individual chunks (only when return_chunks=true)",
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
        description="List of document IDs that were deleted",
    )
    processing_time_ms: float | None = Field(
        default=None,
        description="Processing time in milliseconds",
    )


# ============================================================================
# Document Status Models
# ============================================================================


class DocumentStatusInfo(BaseModel):
    """Status info for a single document."""

    status: str = Field(..., description="Document status: processing, completed, or failed")
    error: str | None = Field(default=None, description="Error message when status is failed")


class DocumentStatusRequest(BaseModel):
    """Request to check statuses of multiple documents."""

    document_ids: list[str] = Field(
        ...,
        min_length=1,
        max_length=200,
        description="List of document IDs to check (max 200)",
    )


class DocumentStatusResponse(BaseModel):
    """Response with document statuses."""

    statuses: dict[str, DocumentStatusInfo | None] = Field(
        ...,
        description="Map of document_id to status info (null if not found)",
    )


# ============================================================================
# Query Models
# ============================================================================


class QueryRequest(BaseModel):
    """Request to query the knowledge base."""

    query: str = Field(..., min_length=1, max_length=10_000, description="Query text")
    top_k: int | None = Field(
        default=None, ge=1, le=1000, description="Number of results to return (overrides default)"
    )
    similarity_threshold: float | None = Field(
        default=None, ge=0.0, le=1.0, description="Minimum similarity score (overrides default)"
    )
    include_metadata: bool = Field(default=True, description="Whether to include metadata in results")
    document_ids: list[str] = Field(
        ...,
        min_length=1,
        max_length=500,
        description="Document IDs to restrict search to.",
    )


class SearchResult(BaseModel):
    """A single search result."""

    content: str = Field(..., description="Content of the result")
    score: float = Field(..., description="Similarity score")
    document_id: str | None = Field(default=None, description="Source document ID")
    filename: str | None = Field(default=None, description="Source document filename")
    metadata: dict[str, Any] | None = Field(default=None, description="Result metadata")


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
    """Request to generate a response using RAG.

    This is a simplified API that uses optimized defaults for RAG:
    - top_k: 30 (~15k chars context for comprehensive answers)
    - temperature: 0.3 (low randomness for factual responses)
    - max_tokens: 2000 (sufficient for detailed answers)

    These parameters are hardcoded for consistency and simplicity.
    """

    query: str = Field(..., max_length=10_000, description="User query")
    document_ids: list[str] = Field(
        ...,
        min_length=1,
        max_length=500,
        description="Document IDs to retrieve context from.",
    )


class GenerateResponse(BaseModel):
    """Response from RAG generation."""

    success: bool = Field(..., description="Whether generation succeeded")
    query: str = Field(..., description="Original query")
    response: str = Field(..., description="Generated response")
    sources: list[SearchResult] = Field(..., description="Source documents used")
    processing_time_ms: float = Field(..., description="Total processing time in milliseconds")


# ============================================================================
# Document Comparison Models
# ============================================================================


class DocumentCompareRequest(BaseModel):
    """Request to compare two documents."""

    base_document_id: str = Field(..., description="Document ID of the base document")
    comparison_document_id: str = Field(..., description="Document ID of the comparison document")
    max_changes: int = Field(default=500, ge=1, le=2000, description="Maximum number of change items to return")


class ComparisonDiffItem(BaseModel):
    """A single diff item within a change block."""

    type: Literal["added", "deleted", "modified", "context"] = Field(..., description="Type of change")
    base_content: str | None = Field(default=None, description="Content from base document")
    comparison_content: str | None = Field(default=None, description="Content from comparison document")
    content: str | None = Field(default=None, description="Context content (for type='context' only)")


class ComparisonChangeBlock(BaseModel):
    """A group of adjacent changes with surrounding context."""

    context_before: str | None = Field(default=None, description="Truncated paragraph before the change block")
    items: list[ComparisonDiffItem] = Field(..., description="Diff items in this block")
    context_after: str | None = Field(default=None, description="Truncated paragraph after the change block")


class ComparisonDiffStats(BaseModel):
    """Statistics about the comparison."""

    total_paragraphs_base: int = Field(..., description="Total paragraphs in base document")
    total_paragraphs_comparison: int = Field(..., description="Total paragraphs in comparison document")
    unchanged: int = Field(default=0, description="Number of unchanged paragraphs")
    modified: int = Field(default=0, description="Number of modified paragraphs")
    added: int = Field(default=0, description="Number of added paragraphs")
    deleted: int = Field(default=0, description="Number of deleted paragraphs")
    high_divergence: bool = Field(
        default=False,
        description="True if >70% of paragraphs differ (documents may be structurally incomparable)",
    )


class ComparisonDocumentInfo(BaseModel):
    """Minimal document info in comparison response."""

    document_id: str = Field(..., description="Document identifier")
    title: str | None = Field(default=None, description="Document filename")


class DocumentCompareResponse(BaseModel):
    """Response from document comparison."""

    success: bool = Field(..., description="Whether the comparison succeeded")
    base_document: ComparisonDocumentInfo = Field(..., description="Base document info")
    comparison_document: ComparisonDocumentInfo = Field(..., description="Comparison document info")
    change_blocks: list[ComparisonChangeBlock] = Field(..., description="Grouped change blocks")
    stats: ComparisonDiffStats = Field(..., description="Comparison statistics")
    truncated: bool = Field(default=False, description="Whether changes were truncated due to max_changes limit")


# ============================================================================
# Error Models
# ============================================================================


class ErrorResponse(BaseModel):
    """Error response."""

    error: str = Field(..., description="Error type")
    message: str = Field(..., description="Error message")
    details: dict[str, Any] | None = Field(default=None, description="Additional error details")

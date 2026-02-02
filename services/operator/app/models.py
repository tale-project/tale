"""
Request and response models for the Operator service.
"""

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    """Health check response."""

    status: str
    version: str
    browser_initialized: bool


class ChatRequest(BaseModel):
    """Chat request - send a message to OpenCode with Playwright MCP."""

    message: str = Field(..., description="The message/task for OpenCode")


class TokenUsage(BaseModel):
    """Token usage statistics."""

    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    cache_read_tokens: int = 0


class ChatResponse(BaseModel):
    """Chat response from OpenCode."""

    success: bool
    message: str
    response: str | None = None
    error: str | None = None
    duration_seconds: float | None = Field(None, description="Execution time in seconds")
    token_usage: TokenUsage | None = Field(None, description="Token consumption statistics")
    cost_usd: float | None = None
    turns: int | None = None
    sources: list[str] = Field(default_factory=list, description="URLs from tool results")

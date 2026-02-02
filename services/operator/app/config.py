"""
Configuration for the Tale Operator service.
"""

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings."""

    # Server configuration (OPERATOR_ prefix)
    host: str = Field(default="0.0.0.0", validation_alias="OPERATOR_HOST")
    port: int = Field(default=8004, validation_alias="OPERATOR_PORT")
    workers: int = Field(default=1, validation_alias="OPERATOR_WORKERS")
    log_level: str = Field(default="info", validation_alias="OPERATOR_LOG_LEVEL")

    # CORS configuration
    allowed_origins: str = Field(default="*", validation_alias="OPERATOR_ALLOWED_ORIGINS")

    # Browser configuration (OPERATOR_ prefix)
    headless: bool = Field(default=True, validation_alias="OPERATOR_HEADLESS")
    timeout: int = Field(default=30, validation_alias="OPERATOR_TIMEOUT")
    max_steps: int = Field(default=30, validation_alias="OPERATOR_MAX_STEPS")

    # Workspace configuration for concurrent requests
    max_concurrent_requests: int = Field(
        default=10,
        ge=1,
        le=50,
        validation_alias="OPERATOR_MAX_CONCURRENT_REQUESTS",
        description="Maximum number of concurrent requests",
    )
    request_timeout_seconds: int = Field(
        default=1800,
        ge=60,
        validation_alias="OPERATOR_REQUEST_TIMEOUT",
        description="Maximum timeout for a single request (30 minutes default)",
    )
    cleanup_interval_seconds: int = Field(
        default=60,
        ge=10,
        validation_alias="OPERATOR_CLEANUP_INTERVAL",
        description="Interval between cleanup cycles",
    )
    workspace_base_dir: str = Field(
        default="/tmp/operator-sessions",
        validation_alias="OPERATOR_WORKSPACE_BASE_DIR",
        description="Base directory for isolated workspaces",
    )
    workspace_max_size_mb: int = Field(
        default=500,
        ge=100,
        validation_alias="OPERATOR_WORKSPACE_MAX_SIZE_MB",
        description="Maximum total workspace disk usage in MB",
    )

    # LLM configuration (from OPENAI_* env vars - used by OpenCode)
    openai_base_url: str = ""
    openai_api_key: str = ""
    openai_model: str = "gpt-4o"
    openai_vision_model: str = ""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    @field_validator("openai_api_key")
    @classmethod
    def validate_api_key(cls, v: str) -> str:
        if not v:
            raise ValueError("OPENAI_API_KEY is required but not set")
        return v

    @property
    def llm_base_url(self) -> str:
        return self.openai_base_url

    @property
    def llm_api_key(self) -> str:
        return self.openai_api_key

    @property
    def llm_model(self) -> str:
        return self.openai_model

    @property
    def llm_vision_model(self) -> str | None:
        """Return vision model if configured, None otherwise."""
        return self.openai_vision_model if self.openai_vision_model else None


# Global settings instance
settings = Settings()

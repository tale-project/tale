"""Configuration management for Tale RAG service.

Configuration is loaded from environment variables with the RAG_ prefix.
LLM settings prefer generic OPENAI_* env vars (OPENAI_API_KEY, OPENAI_BASE_URL,
OPENAI_FAST_MODEL, OPENAI_EMBEDDING_MODEL) with RAG_* overrides available.
"""

import os

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from tale_shared.utils.model_list import get_first_model


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_prefix="RAG_",
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ========================================================================
    # Server Configuration
    # ========================================================================
    host: str = "0.0.0.0"
    port: int = 8001
    log_level: str = "info"

    # ========================================================================
    # Database Configuration
    # ========================================================================
    database_url: str | None = None
    database_pool_min: int = 2
    database_pool_max: int = 10

    # ========================================================================
    # LLM Provider Configuration (OpenAI-compatible)
    # ========================================================================
    openai_api_key: str | None = None
    openai_base_url: str | None = None
    openai_max_tokens: int | None = None
    openai_temperature: float | None = None

    # ========================================================================
    # Chunking & Search Configuration
    # ========================================================================
    chunk_size: int = 2048
    chunk_overlap: int = 200
    top_k: int = 5
    similarity_threshold: float = 0.7
    max_document_size_mb: int = 100
    ingestion_timeout_seconds: int = 10800

    # ========================================================================
    # Vision API Configuration
    # ========================================================================
    openai_vision_model: str | None = None
    vision_max_concurrent_pages: int = 1
    vision_pdf_dpi: int = 150
    vision_extraction_prompt: str | None = None
    vision_request_timeout: int = 180
    vision_preprocessing_timeout: int = 0

    # ========================================================================
    # Feature Flags
    # ========================================================================
    enable_metrics: bool = True
    enable_query_logging: bool = False

    # ========================================================================
    # Job Cleanup Configuration
    # ========================================================================
    # TTL in hours for completed jobs before cleanup (14 days)
    # Note: RAG status is now persisted in Convex database, so job files
    # are only needed for debugging. Safe to clean up after 14 days.
    job_completed_ttl_hours: int = Field(default=336, ge=0)
    # TTL in hours for failed jobs before cleanup (14 days)
    job_failed_ttl_hours: int = Field(default=336, ge=0)
    # TTL in hours for orphaned jobs (stuck in running/queued state)
    job_orphaned_ttl_hours: int = Field(default=24, ge=0)
    # Whether to run job cleanup on service startup
    job_cleanup_on_startup: bool = True

    # ========================================================================
    # CORS Configuration
    # ========================================================================
    allowed_origins: str = "*"

    def get_database_url(self) -> str:
        """Get database URL from RAG_DATABASE_URL only; no fallbacks."""
        if self.database_url:
            return self.database_url
        raise ValueError("RAG_DATABASE_URL must be set in environment")

    def get_llm_config(self) -> dict:
        """Get LLM configuration.

        LLM and embedding configuration is driven by generic OPENAI_* environment
        variables so that the same settings can be shared across services.

        Required environment variables:
        - OPENAI_API_KEY: API key for OpenAI-compatible provider
        - OPENAI_BASE_URL: Base URL for the API endpoint
        - OPENAI_FAST_MODEL: LLM model name (fast model for RAG)
        - OPENAI_EMBEDDING_MODEL: Embedding model name

        Raises:
            ValueError: If any required environment variable is not set.
        """
        api_key = self.openai_api_key or os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY must be set in environment. No default API key is provided.")

        # Base URL: prefer RAG_OPENAI_BASE_URL (openai_base_url), then OPENAI_BASE_URL
        base_url = self.openai_base_url or os.environ.get("OPENAI_BASE_URL")
        if not base_url:
            raise ValueError("OPENAI_BASE_URL must be set in environment. No default base URL is provided.")

        # Model: use OPENAI_FAST_MODEL (required)
        model = get_first_model(os.environ.get("OPENAI_FAST_MODEL"))
        if not model:
            raise ValueError("OPENAI_FAST_MODEL must be set in environment. No default model is provided.")

        # Embedding model: use OPENAI_EMBEDDING_MODEL (required)
        embedding_model = os.environ.get("OPENAI_EMBEDDING_MODEL")
        if not embedding_model:
            raise ValueError(
                "OPENAI_EMBEDDING_MODEL must be set in environment. No default embedding model is provided."
            )

        # Max tokens: prefer RAG_OPENAI_MAX_TOKENS (openai_max_tokens), then OPENAI_MAX_TOKENS
        max_tokens: int | None = None
        if self.openai_max_tokens is not None:
            max_tokens = self.openai_max_tokens
        else:
            max_tokens_env = os.environ.get("OPENAI_MAX_TOKENS")
            if max_tokens_env is not None:
                max_tokens = int(max_tokens_env)

        # Temperature: prefer RAG_OPENAI_TEMPERATURE, then OPENAI_TEMPERATURE.
        temperature: float | None = None
        if self.openai_temperature is not None:
            temperature = self.openai_temperature
        else:
            temperature_env = os.environ.get("OPENAI_TEMPERATURE")
            if temperature_env is not None:
                temperature = float(temperature_env)

        config: dict = {
            "provider": "openai",
            "model": model,
            "embedding_model": embedding_model,
            "api_key": api_key,
            "base_url": base_url,
        }

        if max_tokens is not None:
            config["max_tokens"] = max_tokens

        if temperature is not None:
            config["temperature"] = temperature

        return config

    def get_embedding_dimensions(self) -> int:
        """Get the embedding dimensions for vector storage.

        This value must match the output dimensions of your embedding model.
        Common values:
        - OpenAI text-embedding-3-small: 1536
        - OpenAI text-embedding-3-large: 3072
        - Qwen qwen3-embedding-4b: 2560

        Required environment variable:
        - EMBEDDING_DIMENSIONS: Integer specifying vector dimensions

        Raises:
            ValueError: If EMBEDDING_DIMENSIONS is not set or invalid.
        """
        dimensions_str = os.environ.get("EMBEDDING_DIMENSIONS")
        if not dimensions_str:
            raise ValueError(
                "EMBEDDING_DIMENSIONS must be set in environment. "
                "This must match your embedding model's output dimensions. "
                "Common values: 1536 (text-embedding-3-small), "
                "3072 (text-embedding-3-large), 2560 (qwen3-embedding-4b)."
            )
        try:
            dimensions = int(dimensions_str)
        except ValueError:
            raise ValueError(
                f"EMBEDDING_DIMENSIONS must be a valid positive integer, got: {dimensions_str!r}"
            ) from None
        if dimensions <= 0:
            raise ValueError(f"EMBEDDING_DIMENSIONS must be a positive integer, got: {dimensions}")
        return dimensions

    def get_vision_model(self) -> str:
        """Get the Vision model for OCR and image description.

        Priority:
        1. RAG_OPENAI_VISION_MODEL (openai_vision_model)
        2. OPENAI_VISION_MODEL env var

        Raises:
            ValueError: If no vision model is configured.
        """
        vision_model = get_first_model(self.openai_vision_model) or get_first_model(
            os.environ.get("OPENAI_VISION_MODEL")
        )
        if not vision_model:
            raise ValueError("OPENAI_VISION_MODEL must be set in environment. No default vision model is provided.")
        return vision_model

    def get_allowed_origins_list(self) -> list[str]:
        """Parse allowed origins from comma-separated string."""
        if self.allowed_origins == "*":
            return ["*"]
        return [o for o in (origin.strip() for origin in self.allowed_origins.split(",")) if o]


# Global settings instance
settings = Settings()

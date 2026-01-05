"""Configuration management for Tale RAG service.

Configuration is loaded from environment variables with the RAG_ prefix.
LLM settings prefer generic OPENAI_* env vars (OPENAI_API_KEY, OPENAI_BASE_URL,
OPENAI_MODEL, OPENAI_EMBEDDING_MODEL) with RAG_* overrides available.
"""

import os
from typing import Optional
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


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
    # PostgreSQL connection for cognee storage and PGVector
    database_url: Optional[str] = None

    # ========================================================================
    # Graph Database Configuration (Kuzu Remote)
    # ========================================================================
    graph_db_provider: str = "kuzu-remote"
    graph_db_url: str = "http://graph-db:8000"

    # ========================================================================
    # LLM Provider Configuration (OpenAI-compatible)
    # ========================================================================
    # Supports OpenAI-compatible APIs. Set openai_base_url for alternatives:
    #   - OpenRouter: https://openrouter.ai/api/v1
    #   - DeepSeek: https://api.deepseek.com
    #   - Together AI: https://api.together.xyz/v1
    #   - Ollama (local): http://localhost:11434/v1
    openai_api_key: Optional[str] = None
    openai_base_url: Optional[str] = None
    openai_max_tokens: Optional[int] = None
    openai_temperature: Optional[float] = None

    # ========================================================================
    # Cognee Configuration
    # ========================================================================
    cognee_data_dir: str = "/app/data"
    chunk_size: int = 512
    chunk_overlap: int = 50
    top_k: int = 5
    similarity_threshold: float = 0.7
    max_document_size_mb: int = 50
    # Maximum time (in seconds) for document ingestion before timeout
    # Default: 3 hours (10800 seconds)
    ingestion_timeout_seconds: int = 10800

    # ========================================================================
    # Vision API Configuration
    # ========================================================================
    # Vision model for OCR and image description (OpenAI-compatible)
    openai_vision_model: Optional[str] = None
    # Maximum concurrent Vision API calls per PDF
    vision_max_concurrent_pages: int = 5
    # DPI for rendering PDF pages as images for OCR
    vision_pdf_dpi: int = 150
    # Custom prompt for text extraction (optional)
    vision_extraction_prompt: Optional[str] = None

    # ========================================================================
    # Feature Flags
    # ========================================================================
    enable_graph_storage: bool = True
    enable_vector_search: bool = True
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
        """Get LLM configuration for cognee.

        LLM and embedding configuration is driven by generic OPENAI_* environment
        variables so that the same settings can be shared across services.
        All required environment variables must be explicitly set - no defaults.

        Required environment variables:
        - OPENAI_API_KEY: API key for OpenAI-compatible provider
        - OPENAI_BASE_URL: Base URL for the API endpoint
        - OPENAI_MODEL: LLM model name
        - OPENAI_EMBEDDING_MODEL: Embedding model name

        Raises:
            ValueError: If any required environment variable is not set.
        """
        # API key: prefer RAG_OPENAI_API_KEY (openai_api_key), then OPENAI_API_KEY
        api_key = self.openai_api_key or os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise ValueError(
                "OPENAI_API_KEY must be set in environment. "
                "No default API key is provided."
            )

        # Base URL: prefer RAG_OPENAI_BASE_URL (openai_base_url), then OPENAI_BASE_URL
        base_url = self.openai_base_url or os.environ.get("OPENAI_BASE_URL")
        if not base_url:
            raise ValueError(
                "OPENAI_BASE_URL must be set in environment. "
                "No default base URL is provided."
            )

        # Model: use OPENAI_MODEL (required)
        model = os.environ.get("OPENAI_MODEL")
        if not model:
            raise ValueError(
                "OPENAI_MODEL must be set in environment. "
                "No default model is provided."
            )

        # Embedding model: use OPENAI_EMBEDDING_MODEL (required)
        embedding_model = os.environ.get("OPENAI_EMBEDDING_MODEL")
        if not embedding_model:
            raise ValueError(
                "OPENAI_EMBEDDING_MODEL must be set in environment. "
                "No default embedding model is provided."
            )

        # Max tokens: prefer RAG_OPENAI_MAX_TOKENS (openai_max_tokens), then OPENAI_MAX_TOKENS
        max_tokens: int | None = None
        if self.openai_max_tokens is not None:
            max_tokens = self.openai_max_tokens
        else:
            max_tokens_env = os.environ.get("OPENAI_MAX_TOKENS")
            if max_tokens_env is not None:
                max_tokens = int(max_tokens_env)

        # Temperature: prefer RAG_OPENAI_TEMPERATURE (openai_temperature), then OPENAI_TEMPERATURE.
        # If neither is set, do NOT force a default so the underlying client/BAML
        # can use its own model-appropriate default.
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
            )
        if dimensions <= 0:
            raise ValueError(
                f"EMBEDDING_DIMENSIONS must be a positive integer, got: {dimensions}"
            )
        return dimensions

    def get_vision_model(self) -> str:
        """Get the Vision model for OCR and image description.

        Priority:
        1. RAG_OPENAI_VISION_MODEL (openai_vision_model)
        2. OPENAI_VISION_MODEL env var

        Raises:
            ValueError: If no vision model is configured.
        """
        vision_model = self.openai_vision_model or os.environ.get("OPENAI_VISION_MODEL")
        if not vision_model:
            raise ValueError(
                "OPENAI_VISION_MODEL must be set in environment. "
                "No default vision model is provided."
            )
        return vision_model

    def get_allowed_origins_list(self) -> list[str]:
        """Parse allowed origins from comma-separated string."""
        if self.allowed_origins == "*":
            return ["*"]
        return [o for o in (origin.strip() for origin in self.allowed_origins.split(",")) if o]


# Global settings instance
settings = Settings()


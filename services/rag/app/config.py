"""Configuration management for Tale RAG service.

Configuration is loaded from environment variables with the RAG_ prefix.
LLM settings prefer generic OPENAI_* env vars (OPENAI_API_KEY, OPENAI_BASE_URL,
OPENAI_FAST_MODEL, OPENAI_EMBEDDING_MODEL) with RAG_* overrides available.
"""

import os

from pydantic import Field
from pydantic_settings import SettingsConfigDict
from tale_shared.config import BaseServiceSettings


class Settings(BaseServiceSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_prefix="RAG_",
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Override base defaults
    port: int = 8001

    # Database pool sizing
    database_pool_min: int = 2
    database_pool_max: int = 10

    # Extended LLM settings
    openai_max_tokens: int | None = None
    openai_temperature: float | None = None

    # Chunking & Search
    chunk_size: int = 2048
    chunk_overlap: int = 200
    top_k: int = 5
    similarity_threshold: float = 0.0
    max_document_size_mb: int = 100
    ingestion_timeout_seconds: int = 10800

    # Vision (additional settings beyond base)
    vision_extraction_prompt: str | None = None
    vision_preprocessing_timeout: int = 0

    # Feature Flags
    enable_metrics: bool = True
    enable_query_logging: bool = False

    # Job Cleanup
    job_completed_ttl_hours: int = Field(default=336, ge=0)
    job_failed_ttl_hours: int = Field(default=336, ge=0)
    job_orphaned_ttl_hours: int = Field(default=24, ge=0)
    job_cleanup_on_startup: bool = True

    def get_database_url(self) -> str:
        """Get database URL from RAG_DATABASE_URL only; no fallbacks."""
        if self.database_url:
            return self.database_url
        raise ValueError("RAG_DATABASE_URL must be set in environment")

    def get_llm_config(self) -> dict:
        """Get LLM configuration.

        Each setting checks RAG_* prefixed field first, then falls back to
        the shared OPENAI_* env var.
        """
        api_key = self.get_openai_api_key()

        base_url = self.get_openai_base_url()
        if not base_url:
            raise ValueError("OPENAI_BASE_URL must be set in environment. No default base URL is provided.")

        model = self.get_fast_model()
        embedding_model = self.get_embedding_model()

        max_tokens = self.openai_max_tokens
        if max_tokens is None:
            max_tokens_env = os.environ.get("OPENAI_MAX_TOKENS")
            if max_tokens_env is not None:
                max_tokens = int(max_tokens_env)

        temperature = self.openai_temperature
        if temperature is None:
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


# Global settings instance
settings = Settings()

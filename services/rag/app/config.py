"""Configuration management for Tale RAG service.

Configuration is loaded from environment variables with the RAG_ prefix.
LLM settings prefer generic OPENAI_* env vars (OPENAI_API_KEY, OPENAI_BASE_URL,
OPENAI_MODEL, OPENAI_EMBEDDING_MODEL) with RAG_* overrides available.
"""

import os
from typing import Optional
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

    # ========================================================================
    # Feature Flags
    # ========================================================================
    enable_graph_storage: bool = True
    enable_vector_search: bool = True
    enable_metrics: bool = True
    enable_query_logging: bool = False

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
        The RAG service no longer has separate RAG_* overrides for model names;
        it always uses OPENAI_MODEL and OPENAI_EMBEDDING_MODEL.
        """
        # API key: prefer RAG_OPENAI_API_KEY (openai_api_key), then OPENAI_API_KEY
        api_key = self.openai_api_key or os.environ.get("OPENAI_API_KEY")

        # Base URL: prefer RAG_OPENAI_BASE_URL (openai_base_url), then OPENAI_BASE_URL, then default
        base_url = (
            self.openai_base_url
            or os.environ.get("OPENAI_BASE_URL")
            or "https://api.openai.com/v1"
        )

        # Model: use OPENAI_MODEL, then default
        model = os.environ.get("OPENAI_MODEL") or "gpt-4o"

        # Embedding model: use OPENAI_EMBEDDING_MODEL, then default OpenAI embedding model.
        embedding_model = os.environ.get("OPENAI_EMBEDDING_MODEL") or "text-embedding-3-small"

        # Max tokens: prefer RAG_OPENAI_MAX_TOKENS (openai_max_tokens), then OPENAI_MAX_TOKENS, then default
        if self.openai_max_tokens is not None:
            max_tokens = self.openai_max_tokens
        else:
            max_tokens_env = os.environ.get("OPENAI_MAX_TOKENS")
            max_tokens = int(max_tokens_env) if max_tokens_env is not None else 4096

        # Temperature: prefer RAG_OPENAI_TEMPERATURE (openai_temperature), then OPENAI_TEMPERATURE.
        # If neither is set, do NOT force a default so the underlying client/BAML
        # can use its own model-appropriate default (e.g., some GPT-5.* models only
        # support the provider's built-in temperature).
        temperature = None
        if self.openai_temperature is not None:
            temperature = self.openai_temperature
        else:
            temperature_env = os.environ.get("OPENAI_TEMPERATURE")
            if temperature_env is not None:
                temperature = float(temperature_env)

        config = {
            "provider": "openai",
            "model": model,
            "embedding_model": embedding_model,
            "max_tokens": max_tokens,
            "base_url": base_url,  # Always include base_url for OpenAI-compatible APIs
        }

        if temperature is not None:
            config["temperature"] = temperature

        if api_key:
            config["api_key"] = api_key

        return config

    def get_allowed_origins_list(self) -> list[str]:
        """Parse allowed origins from comma-separated string."""
        if self.allowed_origins == "*":
            return ["*"]
        return [o for o in (origin.strip() for origin in self.allowed_origins.split(",")) if o]


# Global settings instance
settings = Settings()


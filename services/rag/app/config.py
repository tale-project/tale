"""Configuration management for Tale RAG service.

Most configuration is loaded from environment variables with the RAG_ prefix.
LLM and embedding configuration prefer generic OPENAI_* env vars (OPENAI_API_KEY,
OPENAI_BASE_URL, OPENAI_MODEL, OPENAI_EMBEDDING_MODEL, etc.) with RAG_* overrides.
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
    workers: int = 1
    log_level: str = "info"
    reload: bool = False

    # ========================================================================
    # Database Configuration
    # ========================================================================
    # PostgreSQL connection for cognee storage
    database_url: Optional[str] = None
    database_pool_size: int = 10
    database_max_overflow: int = 20

    # ========================================================================
    # Vector Database Configuration
    # ========================================================================
    # PGVector for vector storage (uses same PostgreSQL database)

    # ========================================================================
    # Graph Database Configuration (Kuzu Remote)
    # ========================================================================
    # Kuzu remote connection for knowledge graph (used by Cognee)
    graph_db_provider: str = "kuzu-remote"
    graph_db_url: str = "http://graph-db:8000"

    # ========================================================================
    # LLM Provider Configuration
    # ========================================================================
    # OpenAI (supports OpenAI-compatible APIs)
    # Set openai_base_url to use alternative providers:
    #   - DeepSeek: https://api.deepseek.com
    #   - Together AI: https://api.together.xyz/v1
    #   - OpenRouter: https://openrouter.ai/api/v1
    #   - Ollama (local): http://localhost:11434/v1
    openai_api_key: Optional[str] = None
    openai_base_url: Optional[str] = None
    openai_max_tokens: Optional[int] = None
    openai_temperature: Optional[float] = None

    # Anthropic
    anthropic_api_key: Optional[str] = None
    anthropic_model: str = "claude-3-5-sonnet-20241022"

    # Azure OpenAI
    azure_openai_api_key: Optional[str] = None
    azure_openai_endpoint: Optional[str] = None
    azure_openai_deployment: Optional[str] = None
    azure_openai_api_version: str = "2024-02-15-preview"

    # ========================================================================
    # Cognee Configuration
    # ========================================================================
    cognee_data_dir: str = "/tmp/tale-rag-data"
    cognee_log_level: str = "INFO"

    # Chunking configuration
    chunk_size: int = 512
    chunk_overlap: int = 50

    # Retrieval configuration
    top_k: int = 5
    similarity_threshold: float = 0.7

    # File upload configuration
    max_document_size_mb: int = 50  # Maximum document size in MB

    def get_cognee_system_root_directory(self) -> str:
        """Get cognee system root directory path.

        Returns the system root directory for Cognee, which is a subdirectory
        of the main data directory.
        """
        base_dir = os.path.abspath(self.cognee_data_dir)
        return os.path.join(base_dir, ".cognee_system")

    # ========================================================================
    # Authentication & Security
    # ========================================================================
    api_key: Optional[str] = None
    secret_key: Optional[str] = None
    allowed_origins: str = "*"

    # ========================================================================
    # Feature Flags
    # ========================================================================
    enable_graph_storage: bool = True
    enable_vector_search: bool = True
    enable_metrics: bool = True
    enable_query_logging: bool = False

    # ========================================================================
    # Performance & Limits
    # ========================================================================
    max_concurrent_requests: int = 10
    request_timeout_seconds: int = 300
    max_request_size_mb: int = 100
    max_document_size_mb: int = 50

    # ========================================================================
    # Monitoring & Observability
    # ========================================================================
    sentry_dsn: Optional[str] = None
    datadog_api_key: Optional[str] = None
    prometheus_enabled: bool = False

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
        }

        if temperature is not None:
            config["temperature"] = temperature

        if api_key:
            config["api_key"] = api_key
            config["base_url"] = base_url

        return config

    def get_allowed_origins_list(self) -> list[str]:
        """Parse allowed origins from comma-separated string."""
        if self.allowed_origins == "*":
            return ["*"]
        return [origin.strip() for origin in self.allowed_origins.split(",")]


# Global settings instance
settings = Settings()


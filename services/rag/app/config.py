"""Configuration management for Tale RAG service.

Configuration is loaded from environment variables with the RAG_ prefix.
LLM settings are read from provider configuration files.
"""

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

    # Recency boost
    recency_boost_enabled: bool = False
    recency_decay_base: float = 0.85
    recency_max_age_days: int = 730

    # Feature Flags
    enable_metrics: bool = True
    enable_query_logging: bool = False

    def get_database_url(self) -> str:
        """Get database URL from RAG_DATABASE_URL only; no fallbacks."""
        if self.database_url:
            return self.database_url
        raise ValueError("RAG_DATABASE_URL must be set in environment")

    def get_llm_config(self) -> dict:
        """Get LLM configuration from provider files."""
        base_url, api_key, model = self.get_chat_config()
        _emb_base_url, _emb_api_key, embedding_model, _dims = self.get_embedding_config()

        config: dict = {
            "provider": "openai",
            "model": model,
            "embedding_model": embedding_model,
            "api_key": api_key,
            "base_url": base_url,
        }

        if self.openai_max_tokens is not None:
            config["max_tokens"] = self.openai_max_tokens

        if self.openai_temperature is not None:
            config["temperature"] = self.openai_temperature

        return config


# Global settings instance
settings = Settings()

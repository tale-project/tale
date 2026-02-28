"""
Configuration for the Tale Crawler service.
"""

import os

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from tale_shared.utils.model_list import get_first_model


class Settings(BaseSettings):
    """Application settings."""

    # Server configuration
    host: str = "0.0.0.0"
    port: int = 8002
    workers: int = 1
    log_level: str = "info"

    # CORS configuration
    allowed_origins: str = "*"

    # Scheduling & crawling frequency
    poll_interval: int = Field(300, ge=1)
    max_concurrent_scans: int = Field(1, ge=1)
    crawl_batch_size: int = Field(5, ge=1)
    crawl_count_before_restart: int = Field(25, ge=1)

    # Database pool
    db_pool_max_size: int = Field(10, ge=2)

    # OpenAI API Configuration
    openai_api_key: str | None = None
    openai_base_url: str | None = None

    # Vision Model (for OCR and image description)
    openai_vision_model: str | None = None
    vision_pdf_dpi: int = 150
    vision_request_timeout: int = 180

    # Fast LLM (for user_input extraction)
    openai_fast_model: str | None = None

    # Concurrency for Vision processing
    vision_max_concurrent_pages: int = 3

    # Database configuration
    database_url: str | None = None

    # Embedding model configuration
    openai_embedding_model: str | None = None
    embedding_dimensions: int | None = None

    model_config = SettingsConfigDict(
        env_prefix="CRAWLER_",
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    def get_openai_api_key(self) -> str:
        """Get OpenAI API key from CRAWLER_OPENAI_API_KEY or OPENAI_API_KEY."""
        api_key = self.openai_api_key or os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY must be set in environment.")
        return api_key

    def get_openai_base_url(self) -> str | None:
        """Get OpenAI base URL from CRAWLER_OPENAI_BASE_URL or OPENAI_BASE_URL."""
        return self.openai_base_url or os.environ.get("OPENAI_BASE_URL")

    def get_vision_model(self) -> str:
        """Get Vision model from CRAWLER_OPENAI_VISION_MODEL or OPENAI_VISION_MODEL."""
        model = get_first_model(self.openai_vision_model) or get_first_model(os.environ.get("OPENAI_VISION_MODEL"))
        if not model:
            raise ValueError("OPENAI_VISION_MODEL must be set in environment.")
        return model

    def get_fast_model(self) -> str:
        """Get Fast LLM model from CRAWLER_OPENAI_FAST_MODEL or OPENAI_FAST_MODEL."""
        model = get_first_model(self.openai_fast_model) or get_first_model(os.environ.get("OPENAI_FAST_MODEL"))
        if not model:
            raise ValueError("OPENAI_FAST_MODEL must be set in environment.")
        return model

    def get_embedding_model(self) -> str:
        """Get embedding model from CRAWLER_OPENAI_EMBEDDING_MODEL or OPENAI_EMBEDDING_MODEL."""
        model = get_first_model(self.openai_embedding_model) or get_first_model(
            os.environ.get("OPENAI_EMBEDDING_MODEL")
        )
        if not model:
            raise ValueError("OPENAI_EMBEDDING_MODEL must be set in environment.")
        return model

    def get_embedding_dimensions(self) -> int:
        """Get embedding dimensions from CRAWLER_EMBEDDING_DIMENSIONS or EMBEDDING_DIMENSIONS."""
        dims = self.embedding_dimensions
        if dims is None:
            raw = os.environ.get("EMBEDDING_DIMENSIONS")
            if raw is not None:
                dims = int(raw)
        if dims is None:
            raise ValueError("EMBEDDING_DIMENSIONS must be set in environment.")
        return dims


# Global settings instance
settings = Settings()

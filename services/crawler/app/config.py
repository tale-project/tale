"""
Configuration for the Tale Crawler service.
"""

import os

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings."""

    # Server configuration
    host: str = "0.0.0.0"
    port: int = 8002
    workers: int = 1
    log_level: str = "info"

    # CORS configuration
    allowed_origins: str = "*"

    # Crawling configuration
    max_concurrent_crawls: int = 5
    default_max_pages: int = 100
    default_word_count_threshold: int = 100
    default_concurrency: int = 20
    request_timeout_seconds: int = 300

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
        model = self.openai_vision_model or os.environ.get("OPENAI_VISION_MODEL")
        if not model:
            raise ValueError("OPENAI_VISION_MODEL must be set in environment.")
        return model

    def get_fast_model(self) -> str:
        """Get Fast LLM model from CRAWLER_OPENAI_FAST_MODEL or OPENAI_FAST_MODEL."""
        model = self.openai_fast_model or os.environ.get("OPENAI_FAST_MODEL")
        if not model:
            raise ValueError("OPENAI_FAST_MODEL must be set in environment.")
        return model


# Global settings instance
settings = Settings()

"""
Configuration for the Tale Crawler service.
"""

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

    model_config = SettingsConfigDict(
        env_prefix="CRAWLER_",
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


# Global settings instance
settings = Settings()


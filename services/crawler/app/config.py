"""
Configuration for the Tale Crawler service.
"""

from pydantic import Field
from pydantic_settings import SettingsConfigDict
from tale_shared.config import BaseServiceSettings


class Settings(BaseServiceSettings):
    """Application settings."""

    model_config = SettingsConfigDict(
        env_prefix="CRAWLER_",
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Override base defaults
    port: int = 8002
    vision_max_concurrent_pages: int = 3

    # Crawler-specific
    workers: int = 1
    poll_interval: int = Field(300, ge=1)
    max_concurrent_scans: int = Field(1, ge=1)
    crawl_batch_size: int = Field(5, ge=1)
    crawl_count_before_restart: int = Field(25, ge=1)
    db_pool_max_size: int = Field(10, ge=2)


# Global settings instance
settings = Settings()

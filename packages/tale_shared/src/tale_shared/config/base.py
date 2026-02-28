"""Base settings class for Tale services.

Provides a common base for pydantic-settings-based configuration with
shared patterns across crawler and RAG services.
"""

import os

from pydantic_settings import BaseSettings


class BaseServiceSettings(BaseSettings):
    """Base settings with common patterns for Tale services.

    Subclass and set model_config with the appropriate env_prefix.
    """

    host: str = "0.0.0.0"
    port: int = 8000
    log_level: str = "info"
    allowed_origins: str = "*"
    database_url: str | None = None

    def get_openai_api_key(self) -> str:
        """Get OpenAI API key from service-prefixed or generic env var."""
        api_key = getattr(self, "openai_api_key", None) or os.environ.get(
            "OPENAI_API_KEY"
        )
        if not api_key:
            raise ValueError("OPENAI_API_KEY must be set in environment.")
        return api_key

    def get_openai_base_url(self) -> str | None:
        """Get OpenAI base URL from service-prefixed or generic env var."""
        return getattr(self, "openai_base_url", None) or os.environ.get(
            "OPENAI_BASE_URL"
        )

    def get_allowed_origins_list(self) -> list[str]:
        """Parse allowed origins from comma-separated string."""
        if self.allowed_origins == "*":
            return ["*"]
        return [
            o
            for o in (origin.strip() for origin in self.allowed_origins.split(","))
            if o
        ]

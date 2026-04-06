"""Base settings class for Tale services.

Provides a common base for pydantic-settings-based configuration with
shared patterns across crawler and RAG services.
"""

import logging

from pydantic_settings import BaseSettings

from tale_shared.config.providers import (
    get_chat_model as _provider_chat_model,
    get_embedding_model as _provider_embedding_model,
    get_vision_model as _provider_vision_model,
)

logger = logging.getLogger(__name__)


class BaseServiceSettings(BaseSettings):
    """Base settings with common patterns for Tale services.

    Subclass and set model_config with the appropriate env_prefix.
    """

    host: str = "0.0.0.0"
    port: int = 8000
    log_level: str = "info"
    allowed_origins: str = "*"
    database_url: str | None = None

    # Vision
    vision_pdf_dpi: int = 150
    vision_request_timeout: int = 180
    vision_max_concurrent_pages: int = 1

    def get_fast_model(self) -> str:
        """Get fast LLM model from provider files."""
        _base_url, _api_key, model_id = _provider_chat_model()
        return model_id

    def get_embedding_model(self) -> str:
        """Get embedding model from provider files."""
        _base_url, _api_key, model_id, _dims = _provider_embedding_model()
        return model_id

    def get_vision_model(self) -> str:
        """Get vision model from provider files."""
        _base_url, _api_key, model_id = _provider_vision_model()
        return model_id

    def get_chat_config(self) -> tuple[str, str, str]:
        """Return (base_url, api_key, model_id) for chat model from provider files."""
        return _provider_chat_model()

    def get_embedding_config(self) -> tuple[str, str, str, int]:
        """Return (base_url, api_key, model_id, dimensions) for embedding model."""
        return _provider_embedding_model()

    def get_vision_config(self) -> tuple[str, str, str]:
        """Return (base_url, api_key, model_id) for vision model."""
        return _provider_vision_model()

    def get_embedding_dimensions(self) -> int:
        """Get embedding dimensions from provider files."""
        _base_url, _api_key, _model_id, dims = _provider_embedding_model()
        return dims

    def get_allowed_origins_list(self) -> list[str]:
        """Parse allowed origins from comma-separated string."""
        if self.allowed_origins == "*":
            return ["*"]
        return [
            o
            for o in (origin.strip() for origin in self.allowed_origins.split(","))
            if o
        ]

"""Base settings class for Tale services.

Provides a common base for pydantic-settings-based configuration with
shared patterns across crawler and RAG services.
"""

import logging
import os

from pydantic_settings import BaseSettings

from tale_shared.config.providers import (
    get_chat_model as _provider_chat_model,
    get_embedding_model as _provider_embedding_model,
    get_vision_model as _provider_vision_model,
)
from tale_shared.utils.model_list import get_first_model

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

    # OpenAI-compatible provider
    openai_api_key: str | None = None
    openai_base_url: str | None = None
    openai_fast_model: str | None = None
    openai_embedding_model: str | None = None
    openai_vision_model: str | None = None

    # Embedding
    embedding_dimensions: int | None = None

    # Vision
    vision_pdf_dpi: int = 150
    vision_request_timeout: int = 180
    vision_max_concurrent_pages: int = 1

    def get_openai_api_key(self) -> str:
        """Get OpenAI API key from service-prefixed or generic env var."""
        api_key = self.openai_api_key or os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY must be set in environment.")
        return api_key

    def get_openai_base_url(self) -> str | None:
        """Get OpenAI base URL from service-prefixed or generic env var."""
        return self.openai_base_url or os.environ.get("OPENAI_BASE_URL")

    def get_fast_model(self) -> str:
        """Get fast LLM model from provider files, then env var fallback."""
        try:
            _base_url, _api_key, model_id = _provider_chat_model()
            return model_id
        except (ValueError, FileNotFoundError):
            logger.debug("No provider chat model found, falling back to env vars")
        model = get_first_model(self.openai_fast_model) or get_first_model(
            os.environ.get("OPENAI_FAST_MODEL")
        )
        if not model:
            raise ValueError("OPENAI_FAST_MODEL must be set in environment.")
        return model

    def get_embedding_model(self) -> str:
        """Get embedding model from provider files, then env var fallback."""
        try:
            _base_url, _api_key, model_id, _dims = _provider_embedding_model()
            return model_id
        except (ValueError, FileNotFoundError):
            logger.debug("No provider embedding model found, falling back to env vars")
        model = get_first_model(self.openai_embedding_model) or get_first_model(
            os.environ.get("OPENAI_EMBEDDING_MODEL")
        )
        if not model:
            raise ValueError("OPENAI_EMBEDDING_MODEL must be set in environment.")
        return model

    def get_vision_model(self) -> str:
        """Get vision model from provider files, then env var fallback."""
        try:
            _base_url, _api_key, model_id = _provider_vision_model()
            return model_id
        except (ValueError, FileNotFoundError):
            logger.debug("No provider vision model found, falling back to env vars")
        model = get_first_model(self.openai_vision_model) or get_first_model(
            os.environ.get("OPENAI_VISION_MODEL")
        )
        if not model:
            raise ValueError("OPENAI_VISION_MODEL must be set in environment.")
        return model

    def get_chat_config(self) -> tuple[str, str, str]:
        """Return (base_url, api_key, model_id) for chat model from provider files, then env var fallback."""
        try:
            return _provider_chat_model()
        except (ValueError, FileNotFoundError):
            logger.debug("No provider chat config found, falling back to env vars")
            return (
                self.get_openai_base_url(),
                self.get_openai_api_key(),
                self.get_fast_model(),
            )

    def get_embedding_config(self) -> tuple[str, str, str, int]:
        """Return (base_url, api_key, model_id, dimensions) for embedding model."""
        try:
            return _provider_embedding_model()
        except (ValueError, FileNotFoundError):
            logger.debug("No provider embedding config found, falling back to env vars")
            return (
                self.get_openai_base_url(),
                self.get_openai_api_key(),
                self.get_embedding_model(),
                self.get_embedding_dimensions(),
            )

    def get_vision_config(self) -> tuple[str, str, str]:
        """Return (base_url, api_key, model_id) for vision model."""
        try:
            return _provider_vision_model()
        except (ValueError, FileNotFoundError):
            logger.debug("No provider vision config found, falling back to env vars")
            return (
                self.get_openai_base_url(),
                self.get_openai_api_key(),
                self.get_vision_model(),
            )

    def get_embedding_dimensions(self) -> int:
        """Get embedding dimensions from provider files, then env var fallback."""
        try:
            _base_url, _api_key, _model_id, dims = _provider_embedding_model()
            return dims
        except (ValueError, FileNotFoundError):
            logger.debug(
                "No provider embedding dimensions found, falling back to env vars"
            )
        dims = self.embedding_dimensions
        if dims is None:
            raw = os.environ.get("EMBEDDING_DIMENSIONS")
            if raw is not None:
                try:
                    dims = int(raw)
                except ValueError:
                    raise ValueError(
                        f"EMBEDDING_DIMENSIONS must be a valid positive integer, got: {raw!r}"
                    ) from None

        if dims is None:
            raise ValueError(
                "EMBEDDING_DIMENSIONS must be set in environment. "
                "This must match your embedding model's output dimensions. "
                "Common values: 1536 (text-embedding-3-small), "
                "3072 (text-embedding-3-large), 2560 (qwen3-embedding-4b)."
            )

        if dims <= 0:
            raise ValueError(
                f"EMBEDDING_DIMENSIONS must be a positive integer, got: {dims}"
            )

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

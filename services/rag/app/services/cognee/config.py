"""Cognee environment configuration and initialization.

This module sets up environment variables and initializes cognee BEFORE
the main cognee package is imported.
"""

import os
from typing import Any
from urllib.parse import urlparse

from loguru import logger

from ...config import settings


def patch_tiktoken() -> None:
    """Patch tiktoken to handle unknown models gracefully.

    Cognee / LiteLLM may call tiktoken.encoding_for_model with custom model
    names like "qwen3-embedding-8b" which tiktoken doesn't recognize. This
    patch falls back to the widely compatible "cl100k_base" encoding.

    The patch is idempotent - calling this function multiple times is safe.
    """
    try:
        import tiktoken  # type: ignore[import-untyped]
    except ImportError:
        return

    # Idempotency check: avoid wrapping multiple times
    if getattr(tiktoken, "_tale_encoding_patch_applied", False):
        return

    _original_encoding_for_model = tiktoken.encoding_for_model

    def _safe_encoding_for_model(model_name: str, *args: Any, **kwargs: Any) -> Any:
        try:
            return _original_encoding_for_model(model_name, *args, **kwargs)
        except KeyError:
            logger.warning(
                "tiktoken could not map {!r} to a tokenizer, falling back to 'cl100k_base'",
                model_name,
            )
            return tiktoken.get_encoding("cl100k_base")

    tiktoken.encoding_for_model = _safe_encoding_for_model
    tiktoken._tale_encoding_patch_applied = True


def setup_cognee_environment() -> None:
    """Set up environment variables for cognee BEFORE importing it.

    Structured output framework:

    We default to BAML (``STRUCTURED_OUTPUT_FRAMEWORK=baml``) for structured
    outputs because BAML's schema-aligned parsing works well across a wide
    range of models (GPT-4, GPT-5, etc.) without requiring native tool-calling
    support.

    Note on temperature: Cognee's default ``BAML_LLM_TEMPERATURE`` is 0.0,
    which newer GPT-5 models reject. We therefore set it to 1.0 (the model
    default) unless an operator explicitly overrides it.
    """
    llm_config = settings.get_llm_config()
    openai_api_key = llm_config.get("api_key") or os.environ.get("OPENAI_API_KEY")

    if not openai_api_key:
        raise ValueError("OpenAI API key is not set. Please set OPENAI_API_KEY in .env file.")

    base_url = (
        llm_config.get("base_url")
        or os.environ.get("OPENAI_BASE_URL")
        or "https://api.openai.com/v1"
    )
    model = os.environ.get("LLM_MODEL") or llm_config.get("model", "gpt-4o")
    embedding_model = os.environ.get("EMBEDDING_MODEL") or llm_config.get(
        "embedding_model", "text-embedding-3-small"
    )

    # For Cognee + LiteLLM, when using an OpenAI-compatible endpoint (like OpenRouter)
    # make sure the model string encodes the provider so LiteLLM can route correctly.
    cognee_llm_model = model
    cognee_embedding_model = embedding_model
    if "api.openai.com" not in base_url:
        if not model.startswith("openai/"):
            cognee_llm_model = f"openai/{model}"
        if not embedding_model.startswith("openai/"):
            cognee_embedding_model = f"openai/{embedding_model}"

    # Set LLM environment variables for Cognee
    # Use setdefault for non-critical settings to allow operator overrides
    provider = "openai"
    os.environ.setdefault("LLM_PROVIDER", provider)
    os.environ.setdefault("LLM_API_KEY", openai_api_key)
    os.environ.setdefault("LLM_ENDPOINT", base_url)
    os.environ.setdefault("LLM_MODEL", cognee_llm_model)

    # Configure embedding provider
    os.environ.setdefault("EMBEDDING_PROVIDER", provider)
    os.environ.setdefault("EMBEDDING_MODEL", cognee_embedding_model)
    os.environ.setdefault("EMBEDDING_API_KEY", openai_api_key)
    os.environ.setdefault("EMBEDDING_ENDPOINT", base_url)

    # Configure BAML for structured outputs
    os.environ.setdefault("STRUCTURED_OUTPUT_FRAMEWORK", "baml")
    os.environ.setdefault("BAML_LLM_PROVIDER", provider)
    os.environ.setdefault("BAML_LLM_MODEL", model)
    os.environ.setdefault("BAML_LLM_ENDPOINT", base_url)
    os.environ.setdefault("BAML_LLM_API_KEY", openai_api_key)
    os.environ.setdefault("BAML_LLM_TEMPERATURE", "1.0")

    # Export OPENAI_* for libraries that look at these env vars
    os.environ.setdefault("OPENAI_API_KEY", openai_api_key)
    os.environ.setdefault("OPENAI_BASE_URL", base_url)

    logger.info(
        "LLM configured - Provider: {}, Model: {}, Embedding: {}",
        provider,
        cognee_llm_model,
        cognee_embedding_model,
    )

    if "openai" not in base_url and embedding_model == "text-embedding-3-small":
        logger.warning(
            "Using default OpenAI embedding model with non-OpenAI base URL {}",
            base_url,
        )

    _setup_database_config()
    _setup_vector_and_graph_config()
    _setup_feature_flags()

    logger.info("Environment configured for cognee")


def _setup_database_config() -> None:
    """Set up database configuration for Cognee."""
    database_url = settings.get_database_url()
    os.environ["DATABASE_URL"] = database_url

    # Parse database URL and set individual environment variables for Cognee
    # We only support PostgreSQL - fail fast if configuration is invalid
    parsed = urlparse(database_url)

    # Validate that we're using PostgreSQL
    if parsed.scheme not in ("postgresql", "postgres"):
        raise ValueError(
            f"Invalid database scheme '{parsed.scheme}'. "
            f"Only PostgreSQL is supported. "
            f"Database URL must start with 'postgresql://' or 'postgres://'"
        )

    # Validate required components
    if not parsed.hostname:
        raise ValueError("Database host is required in DATABASE_URL")
    if not parsed.path or parsed.path == "/":
        raise ValueError("Database name is required in DATABASE_URL")
    if not parsed.username:
        raise ValueError("Database username is required in DATABASE_URL")
    if not parsed.password:
        raise ValueError("Database password is required in DATABASE_URL")

    # Set PostgreSQL configuration for Cognee
    os.environ["DB_PROVIDER"] = "postgres"
    os.environ["DB_NAME"] = parsed.path.lstrip("/")
    os.environ["DB_HOST"] = parsed.hostname
    os.environ["DB_PORT"] = str(parsed.port or 5432)
    os.environ["DB_USERNAME"] = parsed.username
    os.environ["DB_PASSWORD"] = parsed.password

    logger.debug(
        "Configured Cognee to use PostgreSQL: {}@{}:{}/{}",
        parsed.username,
        parsed.hostname,
        parsed.port or 5432,
        parsed.path.lstrip("/"),
    )


def _setup_vector_and_graph_config() -> None:
    """Set up vector and graph database configuration for Cognee."""
    # Set vector database configuration
    # Cognee uses VECTOR_DB_PROVIDER to select the vector store backend
    # Supported providers: LanceDB, PGVector, neptune_analytics, ChromaDB
    # We use PGVector since we already have PostgreSQL configured
    os.environ["VECTOR_DB_PROVIDER"] = "pgvector"

    logger.info("Configured Cognee to use PGVector for vector storage")

    # Set graph database configuration (Kuzu Remote)
    # Cognee uses GRAPH_DATABASE_PROVIDER to select the graph store backend
    os.environ["GRAPH_DATABASE_PROVIDER"] = settings.graph_db_provider
    os.environ["GRAPH_DATABASE_URL"] = settings.graph_db_url

    logger.info(
        f"Configured Cognee to use Kuzu remote graph store: {settings.graph_db_url}"
    )


def _setup_feature_flags() -> None:
    """Set up feature flags for Cognee storage/search backends."""
    os.environ["ENABLE_GRAPH_STORAGE"] = (
        "true" if settings.enable_graph_storage else "false"
    )
    os.environ["ENABLE_VECTOR_SEARCH"] = (
        "true" if settings.enable_vector_search else "false"
    )
    os.environ["ENABLE_METRICS"] = "true" if settings.enable_metrics else "false"
    os.environ["ENABLE_QUERY_LOGGING"] = (
        "true" if settings.enable_query_logging else "false"
    )

    # Set cognee data directory
    os.environ["COGNEE_DATA_DIR"] = settings.cognee_data_dir


def _patch_remote_kuzu_adapter() -> None:
    """Patch RemoteKuzuAdapter to prevent it from creating a local Kuzu database.

    The Cognee RemoteKuzuAdapter inherits from KuzuAdapter and calls
    super().__init__("/tmp/kuzu_remote"), which creates a local Kuzu database
    even though we're using a remote REST API. With multiple uvicorn workers,
    this causes file lock conflicts.

    This patch overrides the RemoteKuzuAdapter.__init__ to skip the parent's
    _initialize_connection() call, which is the method that creates the local
    database. The remote adapter doesn't need a local database since it uses
    HTTP to communicate with the remote Kuzu server.
    """
    try:
        from cognee.infrastructure.databases.graph.kuzu.remote_kuzu_adapter import (
            RemoteKuzuAdapter,
        )

        # Check if already patched
        if getattr(RemoteKuzuAdapter, "_tale_patched", False):
            return

        def patched_init(self, api_url: str, username: str, password: str) -> None:
            """Patched init that skips local Kuzu database creation."""
            import asyncio
            from concurrent.futures import ThreadPoolExecutor

            # Initialize only the minimal attributes needed for RemoteKuzuAdapter
            # WITHOUT calling parent __init__ (which creates a local Kuzu DB)
            self.open_connections = 0
            self._is_closed = False
            self.db_path = "/tmp/kuzu_remote"  # Not actually used
            self.db = None
            self.connection = None
            self.executor = ThreadPoolExecutor()
            self.KUZU_ASYNC_LOCK = asyncio.Lock()
            self._connection_change_lock = asyncio.Lock()

            # RemoteKuzuAdapter-specific attributes
            self.api_url = api_url
            self.username = username
            self.password = password
            self._session = None
            self._schema_initialized = False

        RemoteKuzuAdapter.__init__ = patched_init
        RemoteKuzuAdapter._tale_patched = True
        logger.info(
            "Patched RemoteKuzuAdapter to skip local Kuzu database creation "
            "(fixes multi-worker lock conflicts)"
        )
    except ImportError:
        logger.debug("RemoteKuzuAdapter not available, skipping patch")
    except Exception as e:
        logger.warning(f"Failed to patch RemoteKuzuAdapter: {e}")


def configure_cognee_base_config() -> None:
    """Configure Cognee base configuration (storage roots) BEFORE importing cognee."""
    try:
        from cognee.api.v1.config.config import config as cognee_config
        from cognee.base_config import get_base_config

        base_data_dir = os.path.abspath(settings.cognee_data_dir)
        data_root = os.path.join(base_data_dir, ".data_storage")
        system_root = os.path.join(base_data_dir, ".cognee_system")

        os.makedirs(data_root, exist_ok=True)
        os.makedirs(system_root, exist_ok=True)

        cognee_config.data_root_directory(data_root)
        cognee_config.system_root_directory(system_root)

        base_config = get_base_config()
        logger.info(
            "Cognee base_config pre-import: data_root_directory={!r}, system_root_directory={!r}",
            base_config.data_root_directory,
            base_config.system_root_directory,
        )
    except Exception as cfg_err:
        logger.error("Failed to preconfigure Cognee storage directories: {}", cfg_err)


def initialize_cognee() -> bool:
    """Initialize cognee and return whether it's available.

    This function should be called once at module load time.
    It patches tiktoken, sets up the environment, configures base config,
    and imports cognee.

    Returns:
        True if cognee was successfully imported, False otherwise.
    """
    patch_tiktoken()
    setup_cognee_environment()
    configure_cognee_base_config()

    try:
        # Patch RemoteKuzuAdapter BEFORE importing cognee to prevent
        # local Kuzu database creation that causes multi-worker lock conflicts
        _patch_remote_kuzu_adapter()

        import cognee  # noqa: F401
        logger.info("Cognee imported successfully with preconfigured base_config")
        return True
    except ImportError:
        logger.warning("cognee package not available")
        return False


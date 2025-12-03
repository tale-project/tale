"""Cognee service wrapper for Tale RAG."""

import os
import time
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse
from loguru import logger

# Import settings first to configure environment before importing cognee
from ..config import settings


# Use a single logical dataset for Tale documents by default.
# This avoids creating a separate Cognee dataset for every document_id,
# which can increase memory usage and management overhead when ingesting
# thousands of small documents.
DEFAULT_COGNEE_DATASET_NAME = "tale_documents"

# ---------------------------------------------------------------------------
# Tokenizer compatibility shim for models unknown to tiktoken (e.g. Qwen)
# ---------------------------------------------------------------------------
try:
    import tiktoken  # type: ignore[import-untyped]
except Exception:
    tiktoken = None  # type: ignore[assignment]
else:  # Only patch if tiktoken is available
    _original_encoding_for_model = tiktoken.encoding_for_model

    def _safe_encoding_for_model(model_name: str, *args, **kwargs):  # type: ignore[override]
        """Fallback to a generic encoding when tiktoken doesn't know the model.

        Cognee / LiteLLM may call tiktoken.encoding_for_model with custom model
        names like "qwen3-embedding-8b" which tiktoken doesn't recognize. In that
        case we fall back to the widely compatible "cl100k_base" encoding.
        """

        try:
            return _original_encoding_for_model(model_name, *args, **kwargs)
        except Exception:
            # This mirrors the error message tiktoken would throw, but instead of
            # failing we log and return a safe default.
            logger.warning(
                "tiktoken could not map %r to a tokenizer, falling back to 'cl100k_base'",
                model_name,
            )
            return tiktoken.get_encoding("cl100k_base")

    tiktoken.encoding_for_model = _safe_encoding_for_model




def _setup_cognee_environment():
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
    # Resolve LLM configuration (model, embedding, base URL, tokens, temperature)
    llm_config = settings.get_llm_config()

    # Try to get API key from resolved config first, then fall back to environment variable
    openai_api_key = llm_config.get("api_key") or os.environ.get("OPENAI_API_KEY")

    logger.info(f"Settings openai_api_key: {settings.openai_api_key is not None}")
    logger.info(f"Env OPENAI_API_KEY: {os.environ.get('OPENAI_API_KEY') is not None}")
    logger.info(f"Final openai_api_key: {openai_api_key is not None}")

    if openai_api_key:
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
        # Per LiteLLM docs, prefixing with "openai/" tells it to use the OpenAI-compatible
        # provider with the given api_base.
        cognee_llm_model = model
        cognee_embedding_model = embedding_model
        if "api.openai.com" not in base_url:
            if not model.startswith("openai/"):
                cognee_llm_model = f"openai/{model}"
            if not embedding_model.startswith("openai/"):
                cognee_embedding_model = f"openai/{embedding_model}"

        # Set both generic LLM_* envs (used by Cognee) and OpenAI-compatible ones (used by SDKs)
        provider = "openai"
        os.environ["LLM_PROVIDER"] = provider
        os.environ["LLM_API_KEY"] = openai_api_key
        os.environ["LLM_ENDPOINT"] = base_url
        os.environ["LLM_MODEL"] = cognee_llm_model

        # Configure embedding provider; currently always the same as LLM provider.
        embedding_provider = "openai"
        os.environ["EMBEDDING_PROVIDER"] = embedding_provider
        os.environ["EMBEDDING_MODEL"] = cognee_embedding_model
        # Ensure embeddings use the same key and endpoint as the LLM unless explicitly overridden.
        os.environ.setdefault("EMBEDDING_API_KEY", openai_api_key)
        os.environ.setdefault("EMBEDDING_ENDPOINT", base_url)

        # Default to BAML for structured outputs (works across GPT-4, GPT-5, etc.).
        # Operators can override by setting STRUCTURED_OUTPUT_FRAMEWORK externally.
        os.environ.setdefault("STRUCTURED_OUTPUT_FRAMEWORK", "baml")

        # Configure BAML LLM to mirror the same provider/model/endpoint.
        # Use setdefault so explicit BAML_* env vars (if present) still take precedence.
        os.environ.setdefault("BAML_LLM_PROVIDER", provider)
        os.environ.setdefault("BAML_LLM_MODEL", model)
        os.environ.setdefault("BAML_LLM_ENDPOINT", base_url)
        os.environ.setdefault("BAML_LLM_API_KEY", openai_api_key)

        # Cognee's default BAML_LLM_TEMPERATURE is 0.0, which GPT-5 models reject.
        # Set to 1.0 (the model default) unless explicitly overridden.
        os.environ.setdefault("BAML_LLM_TEMPERATURE", "1.0")

        # Always export OPENAI_* for libraries that look at these env vars
        os.environ["OPENAI_API_KEY"] = openai_api_key
        os.environ["OPENAI_BASE_URL"] = base_url

        # Log configuration (useful for debugging OpenAI-compatible APIs like DeepSeek/OpenRouter)
        effective_model = os.environ.get("LLM_MODEL") or cognee_llm_model
        effective_embedding_model = os.environ.get("EMBEDDING_MODEL") or cognee_embedding_model
        effective_embedding_provider = os.environ.get("EMBEDDING_PROVIDER") or embedding_provider
        embedding_endpoint = os.environ.get("EMBEDDING_ENDPOINT") or base_url

        logger.info(
            "LLM configured - Provider: {provider}, Model: {model}, "
            "Embedding provider: {embedding_provider}, Embedding model: {embedding_model}, "
            "Embedding endpoint: {embedding_endpoint}, Key length: {key_len}".format(
                provider=provider,
                model=effective_model,
                embedding_provider=effective_embedding_provider,
                embedding_model=effective_embedding_model,
                embedding_endpoint=embedding_endpoint,
                key_len=len(openai_api_key),
            )
        )

        # Warn if using the default OpenAI embedding model with a non-OpenAI base URL
        if "openai" not in base_url and embedding_model == "text-embedding-3-small":
            logger.warning(
                "Using default OpenAI embedding model 'text-embedding-3-small' with "
                f"non-OpenAI base URL {base_url}. Set OPENAI_EMBEDDING_MODEL to a "
                "provider-compatible embedding model if this is not intended."
            )
    else:
        error_msg = (
            "OpenAI API key is not set. Please set OPENAI_API_KEY in .env file."
        )
        logger.error(error_msg)
        raise ValueError(error_msg)

    # Set database configuration
    # Cognee requires specific environment variables for database configuration
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

    logger.info(
        f"Configured Cognee to use PostgreSQL: "
        f"{parsed.username}@{parsed.hostname}:{parsed.port or 5432}/{parsed.path.lstrip('/')}"
    )

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

    # Feature flags for Cognee storage/search backends
    # These control whether Cognee will use the graph store, vector search, metrics, etc.
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

    logger.info("Environment configured for cognee")


# Set up environment BEFORE importing cognee
_setup_cognee_environment()

# Configure Cognee base configuration (storage roots) BEFORE importing the top-level 'cognee'
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
        "Cognee base_config pre-import: data_root_directory=%r, system_root_directory=%r",
        base_config.data_root_directory,
        base_config.system_root_directory,
    )
except Exception as cfg_err:
    logger.error(f"Failed to preconfigure Cognee storage directories: {cfg_err}")

# Now import cognee with the configured base config
try:
    import cognee
    COGNEE_AVAILABLE = True
    logger.info("Cognee imported successfully with preconfigured base_config")
except ImportError:
    COGNEE_AVAILABLE = False
    logger.warning("cognee package not available")


class CogneeService:
    """Service wrapper for cognee RAG operations."""

    def __init__(self):
        """Initialize the cognee service."""
        self.initialized = False

    async def _cleanup_legacy_site_packages_data(self) -> None:
        """Remove legacy Cognee Data rows pointing at site-packages .data_storage.

        Earlier versions of our Cognee integration used the default data_root_directory
        under the installed package path (e.g. /usr/local/lib/python3.11/site-packages/
        cognee/.data_storage). Those records now reference files that no longer exist
        after rebuilding the container, and cause FileNotFoundError during cognify().

        This helper runs once on initialization and deletes only rows whose
        raw_data_location still points at the old site-packages path, leaving
        all new data (under /app/data/.data_storage) untouched.
        """
        try:
            from sqlalchemy import select
            from cognee.infrastructure.databases.relational import get_async_session
            from cognee.modules.data.models import Data

            legacy_substring = "/site-packages/cognee/.data_storage/"

            async with get_async_session(auto_commit=False) as session:
                result = await session.execute(
                    select(Data).where(Data.raw_data_location.contains(legacy_substring))
                )
                legacy_rows = result.scalars().all()

                if not legacy_rows:
                    logger.info("No legacy Cognee data rows found under site-packages .data_storage")
                    return

                count = 0
                for row in legacy_rows:
                    await session.delete(row)
                    count += 1

                await session.commit()
                logger.warning(
                    "Removed %d legacy Cognee data rows with raw_data_location containing %s",
                    count,
                    legacy_substring,
                )
        except Exception as cleanup_err:
            logger.error("Failed to cleanup legacy Cognee data rows: %s", cleanup_err)

    async def _cleanup_missing_local_files_data(self) -> None:
        """Remove Cognee Data rows whose local files no longer exist.

        When the container image is rebuilt, any files previously written under the
        Cognee data_root_directory (e.g. /app/data/.data_storage) are lost unless
        that path is backed by a persistent volume. However, the relational
        database rows in cognee.modules.data.models.Data still reference the old
        file paths. During cognify() this results in FileNotFoundError when
        TextDocument readers try to open those files.

        This helper deletes Data rows that:
        - Have a raw_data_location pointing under the current data_root_directory,
        - But whose underlying filesystem path no longer exists.
        """
        try:
            from sqlalchemy import select
            from urllib.parse import urlparse
            from cognee.infrastructure.databases.relational import get_async_session
            from cognee.modules.data.models import Data

            base_data_dir = os.path.abspath(settings.cognee_data_dir)
            data_root_prefix = os.path.join(base_data_dir, ".data_storage")

            async with get_async_session(auto_commit=False) as session:
                result = await session.execute(select(Data))
                rows = result.scalars().all()

                if not rows:
                    logger.info("No Cognee data rows found for missing-file cleanup")
                    return

                missing_rows = []
                for row in rows:
                    location = getattr(row, "raw_data_location", None)
                    if not location:
                        continue

                    # Only consider file:// URLs or absolute paths
                    if isinstance(location, str) and location.startswith("file://"):
                        parsed = urlparse(location)
                        fs_path = parsed.path
                    else:
                        fs_path = str(location)

                    # Restrict cleanup to the current data_root_prefix to avoid
                    # accidentally deleting rows managed by other storage backends.
                    if not fs_path.startswith(data_root_prefix):
                        continue

                    if not os.path.exists(fs_path):
                        missing_rows.append(row)

                if not missing_rows:
                    logger.info(
                        "No Cognee data rows with missing local files under %s",
                        data_root_prefix,
                    )
                    return

                count = 0
                for row in missing_rows:
                    await session.delete(row)
                    count += 1

                await session.commit()
                logger.warning(
                    "Removed %d Cognee data rows whose local files no longer exist under %s",
                    count,
                    data_root_prefix,
                )
        except Exception as cleanup_err:
            logger.error(
                "Failed to cleanup Cognee data rows with missing local files: %s",
                cleanup_err,
            )

    async def initialize(self):
        """Initialize cognee with configuration."""
        if not COGNEE_AVAILABLE:
            raise RuntimeError("cognee package is not installed")

        try:
            # Cognee 0.3.5+ uses environment variables for configuration
            # All configuration is done in _setup_environment()
            # Mark as initialized - cognee will auto-initialize on first use

            # Clean up any legacy data rows that still point at the old
            # site-packages/.data_storage path so cognify() doesn't crash
            # on missing files created by previous container builds.
            await self._cleanup_legacy_site_packages_data()

            # Also clean up rows that reference local files under the current
            # data_root_directory whose underlying files no longer exist (for
            # example after rebuilding the container without a persistent
            # volume mounted at /app/data).
            await self._cleanup_missing_local_files_data()

            self.initialized = True
            logger.info("Cognee initialized successfully")

        except Exception as e:
            logger.error(f"Failed to initialize cognee: {e}")
            raise

    async def add_document(
        self,
        content: str,
        metadata: Optional[Dict[str, Any]] = None,
        document_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Add a document to the knowledge base.

        Args:
            content: Document content
            metadata: Optional metadata
            document_id: Optional custom document ID

        Returns:
            Dictionary with operation results
        """
        if not self.initialized:
            await self.initialize()

        try:
            start_time = time.time()

            # Add document to cognee. We use a shared logical dataset instead of
            # creating one dataset per document_id to keep Cognee's in-memory
            # structures bounded even when ingesting many small documents.
            dataset_name = DEFAULT_COGNEE_DATASET_NAME
            result = await cognee.add(content, dataset_name=dataset_name)

            # Process the document with incremental loading to only process new/updated data.
            # This avoids reprocessing the entire dataset on each call.
            await cognee.cognify(
                datasets=[dataset_name],
                incremental_loading=True,
            )

            processing_time = (time.time() - start_time) * 1000

            logger.info(f"Document added in {processing_time:.2f}ms")

            # Normalize result from cognee.add which may not be a dict in newer versions
            doc_id: str = document_id or "unknown"
            chunks_created: int = 0
            try:
                if isinstance(result, dict):
                    doc_id = document_id or result.get("id") or result.get("document_id") or "unknown"
                    raw_chunks = result.get("chunks", 0)
                    chunks_created = int(raw_chunks) if isinstance(raw_chunks, (int, float, str)) and str(raw_chunks).isdigit() else 0
                else:
                    # Try attribute-style access
                    doc_id = document_id or getattr(result, "id", None) or getattr(result, "document_id", None) or "unknown"
                    maybe_chunks = getattr(result, "chunks", 0)
                    try:
                        chunks_created = int(maybe_chunks)  # best effort
                    except Exception:
                        chunks_created = 0
            except Exception as norm_err:
                logger.debug(f"Could not normalize cognee.add() result ({type(result)}): {norm_err}")

            return {
                "success": True,
                "document_id": doc_id,
                "chunks_created": chunks_created,
                "processing_time_ms": processing_time,
            }

        except Exception as e:
            logger.error(f"Failed to add document: {e}")
            raise

    async def search(
        self,
        query: str,
        top_k: Optional[int] = None,
        similarity_threshold: Optional[float] = None,
        filters: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        """Search the knowledge base.

        Args:
            query: Search query
            top_k: Number of results to return
            similarity_threshold: Minimum similarity score
            filters: Optional metadata filters

        Returns:
            List of search results
        """
        if not self.initialized:
            await self.initialize()

        try:
            start_time = time.time()

            # Use cognee search
            raw_results = await cognee.search(
                query,
                top_k=top_k or settings.top_k,
            )

            # Normalize results - cognee.search may return strings or dicts
            normalized_results = []
            for r in raw_results:
                if isinstance(r, str):
                    # If result is a string, wrap it in a dict
                    normalized_results.append({
                        "content": r,
                        "score": 1.0,  # Default score for string results
                        "document_id": None,
                        "metadata": {},
                    })
                elif isinstance(r, dict):
                    # If result is already a dict, use it as-is
                    normalized_results.append(r)
                else:
                    # Try to convert to dict if it has attributes
                    try:
                        normalized_results.append({
                            "content": getattr(r, "content", str(r)),
                            "score": getattr(r, "score", 1.0),
                            "document_id": getattr(r, "document_id", None),
                            "metadata": getattr(r, "metadata", {}),
                        })
                    except Exception as conv_err:
                        logger.warning(f"Could not normalize search result ({type(r)}): {conv_err}")
                        # Fallback: convert to string
                        normalized_results.append({
                            "content": str(r),
                            "score": 1.0,
                            "document_id": None,
                            "metadata": {},
                        })

            # Filter by similarity threshold if specified
            threshold = similarity_threshold or settings.similarity_threshold
            filtered_results = [
                r for r in normalized_results
                if r.get("score", 0) >= threshold
            ]

            processing_time = (time.time() - start_time) * 1000

            logger.info(
                f"Search completed in {processing_time:.2f}ms, "
                f"found {len(filtered_results)} results (from {len(raw_results)} raw results)",
            )

            return filtered_results

        except Exception as e:
            error_str = str(e)
            # Handle "DatabaseNotCreatedError" - this happens when no documents
            # have been added yet. Return an empty list instead of failing.
            if "DatabaseNotCreatedError" in error_str or "database has not been created" in error_str.lower():
                logger.info(
                    "No documents have been indexed yet. "
                    "Search returning empty results. Add documents first using /api/v1/documents."
                )
                return []
            logger.error(f"Search failed: {e}")
            raise

    async def generate(
        self,
        query: str,
        top_k: Optional[int] = None,
        system_prompt: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Generate a response using RAG.

        Args:
            query: User query
            top_k: Number of context documents
            system_prompt: Optional system prompt
            temperature: LLM temperature
            max_tokens: Maximum tokens to generate

        Returns:
            Dictionary with generated response and sources
        """
        if not self.initialized:
            await self.initialize()

        try:
            start_time = time.time()

            # Search for relevant context
            search_results = await self.search(query, top_k=top_k)

            # Generate response using cognee
            response = await cognee.chat(
                query,
                system_prompt=system_prompt,
            )

            processing_time = (time.time() - start_time) * 1000

            logger.info(f"Generation completed in {processing_time:.2f}ms")

            return {
                "success": True,
                "response": response,
                "sources": search_results,
                "processing_time_ms": processing_time,
            }

        except Exception as e:
            error_str = str(e)
            # Handle "DatabaseNotCreatedError" - this happens when no documents
            # have been added yet. Return a helpful message instead of failing.
            if "DatabaseNotCreatedError" in error_str or "database has not been created" in error_str.lower():
                logger.info(
                    "No documents have been indexed yet. "
                    "Cannot generate response without context."
                )
                return {
                    "success": False,
                    "response": "No documents have been indexed yet. Please add documents first using the /api/v1/documents endpoint.",
                    "sources": [],
                    "processing_time_ms": 0,
                }
            logger.error(f"Generation failed: {e}")
            raise

    async def delete_document(self, document_id: str) -> Dict[str, Any]:
        """Delete a document from the knowledge base.

        Args:
            document_id: ID of the document to delete

        Returns:
            Dictionary with operation results
        """
        if not self.initialized:
            await self.initialize()

        try:
            # Note: cognee may not have direct delete by ID
            # This is a placeholder implementation
            logger.warning(f"Delete operation for {document_id} - implementation pending")

            return {
                "success": True,
                "message": f"Document {document_id} deletion requested",
            }

        except Exception as e:
            logger.error(f"Failed to delete document: {e}")
            raise

    async def reset(self):
        """Reset the knowledge base (delete all data)."""
        if not self.initialized:
            await self.initialize()

        try:
            await cognee.prune.prune_data()
            await cognee.prune.prune_system()
            logger.info("Knowledge base reset successfully")

        except Exception as e:
            logger.error(f"Failed to reset knowledge base: {e}")
            raise


# Global service instance
cognee_service = CogneeService()


"""Cognee environment configuration and initialization.

This module sets up environment variables and initializes cognee BEFORE
the main cognee package is imported.

IMPORTANT: The FalkorDB adapter import triggers cognee import, which reads
LLM environment variables at import time. Therefore, we must set all LLM
environment variables BEFORE importing the adapter.

Upstream Issues (remove patches when fixed):
- https://github.com/topoteretes/cognee-community/issues/59 (Non-ASCII identifiers)
- https://github.com/topoteretes/cognee-community/issues/60 (is_empty IndexError)
- https://github.com/topoteretes/cognee-community/issues/61 (add_nodes IndexError)
"""

import os
import re
from typing import Any
from urllib.parse import urlparse

from loguru import logger

from ...config import settings


def _pre_configure_llm_env() -> None:
    """Set LLM environment variables BEFORE any cognee imports.

    Cognee reads LLM configuration from environment variables at import time.
    This function must be called before importing cognee or any adapter that
    triggers cognee import (like cognee_community_hybrid_adapter_falkor).
    """
    # Get LLM config - this validates required env vars are set
    try:
        llm_config = settings.get_llm_config()
    except ValueError as e:
        logger.warning(f"LLM config not available for pre-configuration: {e}")
        return

    api_key = llm_config["api_key"]
    base_url = llm_config["base_url"]
    model = llm_config["model"]
    embedding_model = llm_config["embedding_model"]

    # Add openai/ prefix for non-OpenAI endpoints (for LiteLLM routing)
    cognee_llm_model = model
    cognee_embedding_model = embedding_model
    if "api.openai.com" not in base_url:
        if not model.startswith("openai/"):
            cognee_llm_model = f"openai/{model}"
        if not embedding_model.startswith("openai/"):
            cognee_embedding_model = f"openai/{embedding_model}"

    # Set LLM environment variables that Cognee reads at import time
    os.environ.setdefault("LLM_PROVIDER", "openai")
    os.environ.setdefault("LLM_API_KEY", api_key)
    os.environ.setdefault("LLM_ENDPOINT", base_url)
    os.environ.setdefault("LLM_MODEL", cognee_llm_model)
    os.environ.setdefault("EMBEDDING_PROVIDER", "openai")
    os.environ.setdefault("EMBEDDING_MODEL", cognee_embedding_model)
    os.environ.setdefault("EMBEDDING_API_KEY", api_key)
    os.environ.setdefault("EMBEDDING_ENDPOINT", base_url)

    # Set embedding dimensions
    try:
        embedding_dimensions = settings.get_embedding_dimensions()
        os.environ.setdefault("EMBEDDING_DIMENSIONS", str(embedding_dimensions))
    except ValueError:
        pass  # Will be set later if available

    # Export OPENAI_* for libraries that look at these env vars
    os.environ.setdefault("OPENAI_API_KEY", api_key)
    os.environ.setdefault("OPENAI_BASE_URL", base_url)

    logger.debug("Pre-configured LLM environment variables for Cognee import")


def _pre_configure_database_env() -> None:
    """Set database environment variables BEFORE any cognee imports.

    Cognee reads database configuration from environment variables at import time.
    This function must be called before importing cognee or any adapter that
    triggers cognee import (like cognee_community_hybrid_adapter_falkor).
    """
    # Get database URL - this validates the env var is set
    try:
        database_url = settings.get_database_url()
    except ValueError as e:
        logger.warning(f"Database config not available for pre-configuration: {e}")
        return

    parsed = urlparse(database_url)

    # Validate URL components to avoid exporting misleading defaults
    if parsed.scheme not in ("postgresql", "postgres"):
        logger.warning(
            f"Invalid DATABASE_URL scheme '{parsed.scheme}' for pre-configuration; skipping DB_* export"
        )
        return
    if not parsed.hostname or not parsed.username or not parsed.password:
        logger.warning(
            "DATABASE_URL missing required components (hostname/username/password); skipping DB_* export"
        )
        return
    if not parsed.path or parsed.path == "/":
        logger.warning("DATABASE_URL missing database name; skipping DB_* export")
        return

    # Set PostgreSQL configuration for Cognee
    # These must be set BEFORE cognee imports
    os.environ["DB_PROVIDER"] = "postgres"
    os.environ["DB_NAME"] = parsed.path.lstrip("/")
    os.environ["DB_HOST"] = parsed.hostname or "localhost"
    os.environ["DB_PORT"] = str(parsed.port or 5432)
    os.environ["DB_USERNAME"] = parsed.username or ""
    os.environ["DB_PASSWORD"] = parsed.password or ""

    # Also set FalkorDB env vars for graph/vector storage
    falkordb_url = os.environ.get("GRAPH_DATABASE_URL", "graph-db")
    falkordb_port = os.environ.get("GRAPH_DATABASE_PORT", "6379")

    os.environ["GRAPH_DATABASE_PROVIDER"] = "falkor"
    os.environ["GRAPH_DATABASE_URL"] = falkordb_url
    os.environ["GRAPH_DATABASE_PORT"] = falkordb_port
    os.environ["GRAPH_DATASET_DATABASE_HANDLER"] = "falkor_graph_local"

    os.environ["VECTOR_DB_PROVIDER"] = "falkor"
    os.environ["VECTOR_DB_URL"] = falkordb_url
    os.environ["VECTOR_DB_PORT"] = falkordb_port
    os.environ["VECTOR_DATASET_DATABASE_HANDLER"] = "falkor_vector_local"

    logger.debug(
        "Pre-configured database environment: PostgreSQL {}@{}:{}/{}, FalkorDB {}:{}",
        parsed.username,
        parsed.hostname,
        parsed.port or 5432,
        parsed.path.lstrip("/"),
        falkordb_url,
        falkordb_port,
    )


# PRE-CONFIGURE ALL env vars BEFORE any cognee-related imports
# This is critical because the adapter import triggers cognee import,
# which reads env vars at import time (not runtime)
_pre_configure_llm_env()
_pre_configure_database_env()

# NOW register FalkorDB adapter (this triggers cognee import)
try:
    from cognee_community_hybrid_adapter_falkor import register  # noqa: F401

    logger.info("FalkorDB adapter registered successfully")
except ImportError:
    logger.warning(
        "cognee-community-hybrid-adapter-falkor not installed, FalkorDB support unavailable"
    )


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


def configure_litellm_drop_params() -> None:
    """Configure LiteLLM to drop unsupported parameters.

    Some OpenAI-compatible API providers (like OpenRouter) don't support all
    OpenAI parameters such as 'encoding_format' for embeddings. This setting
    tells LiteLLM to silently drop unsupported parameters instead of raising
    an exception.

    This is particularly important for embedding calls where 'encoding_format'
    causes 400 errors on non-OpenAI providers.
    """
    try:
        import litellm

        # Enable dropping of unsupported parameters globally
        litellm.drop_params = True

        # Modify embedding parameters to fix OpenRouter compatibility
        # OpenRouter's embeddings API doesn't accept the encoding_format parameter
        # with certain values that LiteLLM sends by default
        litellm.modify_params = True

        logger.info("LiteLLM configured to drop unsupported parameters (drop_params=True, modify_params=True)")
    except ImportError:
        logger.debug("litellm not available, skipping drop_params configuration")


def _patch_litellm_aembedding() -> None:
    """Patch litellm.aembedding to filter empty inputs.

    Cognee's LiteLLMEmbeddingEngine calls litellm.aembedding() directly.
    When FalkorDB adapter's create_data_points collects embeddable values,
    it may produce an empty list if all data points have None properties.

    This patch intercepts aembedding calls to:
    1. Filter out empty strings from input
    2. Return empty response if all inputs are empty (prevents API error)

    This is different from the OpenAIChatCompletion.embedding patch because
    Cognee bypasses that layer by calling aembedding directly.
    """
    try:
        import litellm

        # Check if already patched
        if getattr(litellm, "_tale_aembedding_patch_applied", False):
            return

        _original_aembedding = litellm.aembedding

        # Track aembedding calls
        _aembedding_call_stats = {"count": 0, "total_items": 0}

        async def _patched_aembedding(
            model: str,
            input: list | str,
            **kwargs: Any,
        ) -> Any:
            import time

            # Track call statistics
            _aembedding_call_stats["count"] += 1
            call_num = _aembedding_call_stats["count"]

            input_count = 1 if isinstance(input, str) else len(input) if input else 0
            _aembedding_call_stats["total_items"] += input_count

            logger.warning(
                f"[PERF-EMBED] aembedding call #{call_num} "
                f"(total {_aembedding_call_stats['total_items']} items embedded): "
                f"processing {input_count} text(s)"
            )
            call_start = time.time()

            # Handle string input (OpenAI-compatible APIs accept str or list[str])
            if isinstance(input, str):
                if not input.strip():
                    logger.warning("aembedding: Empty string input, returning empty response")
                    from litellm import EmbeddingResponse
                    return EmbeddingResponse(
                        model=model,
                        data=[],
                        usage={"prompt_tokens": 0, "total_tokens": 0},
                    )
                result = await _original_aembedding(model=model, input=input, **kwargs)
                call_duration = time.time() - call_start
                logger.warning(f"[PERF-EMBED] call #{call_num} complete in {call_duration:.2f}s")
                return result

            # Filter out empty or whitespace-only strings from list input
            original_input_len = len(input) if input else 0
            if input:
                filtered_input = [
                    item for item in input
                    if item and (not isinstance(item, str) or item.strip())
                ]
                if len(filtered_input) < original_input_len:
                    logger.warning(
                        f"aembedding: Filtered {original_input_len - len(filtered_input)} empty inputs "
                        f"(remaining: {len(filtered_input)})"
                    )
                    input = filtered_input

            # If all inputs were filtered out, return empty response
            if not input:
                logger.warning("aembedding: All inputs were empty, returning empty response")
                from litellm import EmbeddingResponse
                return EmbeddingResponse(
                    model=model,
                    data=[],
                    usage={"prompt_tokens": 0, "total_tokens": 0},
                )

            result = await _original_aembedding(model=model, input=input, **kwargs)
            call_duration = time.time() - call_start
            logger.warning(
                f"[PERF-EMBED] call #{call_num} complete in {call_duration:.2f}s "
                f"({input_count / call_duration:.1f} items/sec)"
            )
            return result

        litellm.aembedding = _patched_aembedding
        litellm._tale_aembedding_patch_applied = True
        logger.info("Patched litellm.aembedding to filter empty inputs")
    except ImportError as e:
        logger.debug(f"litellm not available, skipping aembedding patch: {e}")
    except Exception as e:
        logger.warning(f"Failed to patch litellm.aembedding: {e}")


def _patch_litellm_embedding() -> None:
    """Patch LiteLLM OpenAI embedding to remove encoding_format for non-OpenAI endpoints.

    OpenRouter's embeddings API only accepts 'float' or 'base64' for encoding_format,
    but LiteLLM may send other values internally. This patch intercepts the internal
    OpenAI embedding call to remove the encoding_format parameter.

    We patch litellm.llms.openai.openai.OpenAIChatCompletion.embedding method.
    """
    try:
        from litellm.llms.openai.openai import OpenAIChatCompletion

        # Check if already patched
        if getattr(OpenAIChatCompletion, "_tale_embedding_patch_applied", False):
            return

        _original_embedding = OpenAIChatCompletion.embedding

        # Track embedding API calls
        _embedding_call_stats = {"count": 0, "total_items": 0}

        def _patched_embedding(
            self: Any,
            model: str,
            input: list,
            timeout: float,
            logging_obj: Any,
            api_key: str | None = None,
            api_base: str | None = None,
            model_response: Any = None,
            optional_params: dict | None = None,
            client: Any = None,
            aembedding: bool = False,
            **kwargs: Any,
        ) -> Any:
            import time

            # Track call statistics
            _embedding_call_stats["count"] += 1
            call_num = _embedding_call_stats["count"]

            base_url = api_base or os.environ.get("OPENAI_BASE_URL", "")
            input_count = len(input) if isinstance(input, list) else 1
            _embedding_call_stats["total_items"] += input_count

            logger.warning(
                f"[PERF-EMBED] OpenAIChatCompletion.embedding call #{call_num} "
                f"(total {_embedding_call_stats['total_items']} items): "
                f"processing {input_count} text(s) to {base_url}"
            )
            call_start = time.time()

            if optional_params and "api.openai.com" not in base_url:
                optional_params.pop("encoding_format", None)

            # Log text preview for debugging
            if isinstance(input, list):
                previews = []
                for text in input[:3]:  # Show first 3 items
                    text_str = str(text)[:100]  # First 100 chars
                    previews.append(text_str)
                preview_text = " | ".join(previews)
                if len(input) > 3:
                    preview_text += f" ... (+{len(input) - 3} more)"
                logger.debug(f"Embedding {input_count} text(s) with {model}: {preview_text}")
            else:
                preview_text = str(input)[:100]
                logger.debug(f"Embedding {input_count} text(s) with {model}: {preview_text}")

            result = _original_embedding(
                self,
                model=model,
                input=input,
                timeout=timeout,
                logging_obj=logging_obj,
                api_key=api_key,
                api_base=api_base,
                model_response=model_response,
                optional_params=optional_params,
                client=client,
                aembedding=aembedding,
                **kwargs,
            )

            call_duration = time.time() - call_start
            logger.warning(
                f"[PERF-EMBED] call #{call_num} complete in {call_duration:.2f}s "
                f"({input_count / call_duration:.1f} items/sec)"
            )
            return result

        OpenAIChatCompletion.embedding = _patched_embedding
        OpenAIChatCompletion._tale_embedding_patch_applied = True
        logger.info("Patched LiteLLM OpenAI embedding to remove encoding_format")
    except ImportError as e:
        logger.debug(f"litellm not available, skipping embedding patch: {e}")
    except Exception as e:
        logger.warning(f"Failed to patch LiteLLM embedding: {e}")


def _sanitize_identifier_for_cypher(name: str, default: str = "UNKNOWN") -> str:
    """Sanitize a string to ASCII-only for use as a Cypher identifier.

    FalkorDB's Cypher parser only supports ASCII characters in identifiers
    (node labels, relationship types, property names). This function converts
    non-ASCII characters to their transliterated ASCII equivalents using
    unidecode, preserving semantic meaning.

    Examples:
        - "人物" -> "Ren_Wu"
        - "属于" -> "Shu_Yu"
        - "概念实体" -> "Gai_Nian_Shi_Ti"
        - "Document_文档" -> "Document_Wen_Dang"

    Args:
        name: The original identifier name (may contain Unicode characters)
        default: Default value if sanitization results in empty string

    Returns:
        ASCII-only identifier safe for FalkorDB Cypher
    """
    if not name:
        return default

    try:
        from unidecode import unidecode as _unidecode
    except ImportError:
        _unidecode = None

    # Convert non-ASCII to ASCII using unidecode (preserves meaning)
    if _unidecode is not None:
        ascii_name = _unidecode(name)
    else:
        # Fallback: remove non-ASCII characters
        ascii_name = name.encode("ascii", "ignore").decode("ascii")

    # Replace non-alphanumeric with underscores (standard Cypher identifier rules)
    sanitized = re.sub(r"[^a-zA-Z0-9_]", "_", ascii_name)
    # Collapse multiple underscores
    sanitized = re.sub(r"_+", "_", sanitized)
    # Remove leading/trailing underscores
    sanitized = sanitized.strip("_")
    # Ensure it starts with a letter (Cypher requirement for identifiers)
    if sanitized and not sanitized[0].isalpha():
        sanitized = "N_" + sanitized

    return sanitized if sanitized else default


def _patch_falkordb_adapter_relationship_sanitize() -> None:
    """Patch FalkorDB adapter to properly sanitize non-ASCII relationship names.

    Upstream: https://github.com/topoteretes/cognee-community/issues/59
    Remove this patch when the issue is fixed.

    FalkorDB's Cypher parser only supports ASCII characters in relationship type names.
    The original sanitize_relationship_name uses \\w which includes Unicode characters
    like Chinese, causing "Invalid input '�'" errors.

    This patch converts non-ASCII characters to their transliterated ASCII equivalents
    using unidecode, preserving semantic meaning (e.g., "属于" -> "Shu_Yu").
    """
    try:
        from cognee_community_hybrid_adapter_falkor.falkor_adapter import FalkorDBAdapter

        if getattr(FalkorDBAdapter, "_tale_relationship_patch_applied", False):
            return

        import re

        try:
            from unidecode import unidecode
        except ImportError:
            logger.warning("unidecode not installed, falling back to basic ASCII conversion")
            unidecode = None

        def _patched_sanitize_relationship_name(self: Any, relationship_name: str) -> str:
            """Sanitize relationship name to ASCII-only for FalkorDB Cypher compatibility.

            Converts non-ASCII characters to transliterated ASCII using unidecode.
            For example: "属于" -> "Shu_Yu", "関係" -> "Guan_Xi"
            """
            if not relationship_name:
                return "RELATIONSHIP"

            # Convert non-ASCII to ASCII using unidecode (preserves meaning)
            if unidecode is not None:
                ascii_name = unidecode(relationship_name)
            else:
                # Fallback: remove non-ASCII characters
                ascii_name = relationship_name.encode("ascii", "ignore").decode("ascii")

            # Replace non-alphanumeric with underscores (standard Cypher identifier rules)
            sanitized = re.sub(r"[^a-zA-Z0-9_]", "_", ascii_name)
            # Collapse multiple underscores
            sanitized = re.sub(r"_+", "_", sanitized)
            # Remove leading/trailing underscores
            sanitized = sanitized.strip("_")
            # Ensure it starts with a letter (Cypher requirement)
            if sanitized and not sanitized[0].isalpha():
                sanitized = "R_" + sanitized
            # Handle empty result
            if not sanitized:
                return "RELATIONSHIP"

            return sanitized.upper()

        FalkorDBAdapter.sanitize_relationship_name = _patched_sanitize_relationship_name
        FalkorDBAdapter._tale_relationship_patch_applied = True
        logger.info("Patched FalkorDB adapter to sanitize non-ASCII relationship names")

        _original_is_empty = FalkorDBAdapter.is_empty

        async def _patched_is_empty(self: Any) -> bool:
            """Check if the graph is empty, handling empty result sets gracefully.

            Upstream: https://github.com/topoteretes/cognee-community/issues/60
            """
            query = "MATCH (n) RETURN true LIMIT 1;"
            result = self.query(query)
            # Original bug: result_set[0][0] fails with IndexError when graph is empty
            # because an empty graph returns an empty result_set
            if not result.result_set:
                return True  # Empty result means no nodes, so graph is empty
            return False  # If any result exists, graph is not empty

        FalkorDBAdapter.is_empty = _patched_is_empty
        logger.info("Patched FalkorDB adapter is_empty to handle empty result sets")

    except ImportError as e:
        logger.debug(f"FalkorDB adapter not available, skipping relationship patch: {e}")
    except Exception as e:
        logger.warning(f"Failed to patch FalkorDB adapter: {e}")


def _patch_falkordb_adapter_add_node() -> None:
    """Patch FalkorDB adapter to sanitize non-ASCII node labels.

    Upstream: https://github.com/topoteretes/cognee-community/issues/59
    Remove this patch when the issue is fixed.

    FalkorDB's Cypher parser only supports ASCII characters in node labels.
    The add_node method uses properties["type"] as the node label, which may
    contain non-ASCII characters (e.g., Chinese entity types from LLM extraction).

    This patch converts non-ASCII type names to ASCII equivalents using
    _sanitize_identifier_for_cypher before passing to the original method.
    """
    try:
        from cognee_community_hybrid_adapter_falkor.falkor_adapter import FalkorDBAdapter

        if getattr(FalkorDBAdapter, "_tale_add_node_patch_applied", False):
            return

        _original_add_node = FalkorDBAdapter.add_node

        async def _patched_add_node(self: Any, node_id: str, properties: dict[str, Any]) -> None:
            """Add node with sanitized label for FalkorDB Cypher compatibility."""
            # Shallow copy to avoid mutating caller's dict
            sanitized_properties = properties.copy()

            # Sanitize the type (node label)
            if "type" in sanitized_properties:
                original_type = sanitized_properties["type"]
                sanitized_type = _sanitize_identifier_for_cypher(original_type, "Node")
                sanitized_properties["type"] = sanitized_type

            # Sanitize index_fields (used for vector property names)
            if "metadata" in sanitized_properties:
                metadata = sanitized_properties.get("metadata", {})
                if metadata and "index_fields" in metadata:
                    original_fields = metadata["index_fields"]
                    sanitized_fields = []
                    for field in original_fields:
                        sanitized_field = _sanitize_identifier_for_cypher(field, "field")
                        sanitized_fields.append(sanitized_field)
                        # Rename vector property keys if field name changed
                        if field != sanitized_field:
                            vector_key = f"{field}_vector"
                            if vector_key in sanitized_properties:
                                sanitized_properties[f"{sanitized_field}_vector"] = (
                                    sanitized_properties.pop(vector_key)
                                )
                    sanitized_properties["metadata"] = {**metadata, "index_fields": sanitized_fields}

            return await _original_add_node(self, node_id, sanitized_properties)

        FalkorDBAdapter.add_node = _patched_add_node
        FalkorDBAdapter._tale_add_node_patch_applied = True
        logger.info("Patched FalkorDB adapter add_node for ASCII node labels")

    except ImportError as e:
        logger.debug(f"FalkorDB adapter not available, skipping add_node patch: {e}")
    except Exception as e:
        logger.warning(f"Failed to patch FalkorDB adapter add_node: {e}")


def _patch_falkordb_adapter_stringify_properties() -> None:
    """Patch FalkorDB adapter to sanitize non-ASCII property names.

    Upstream: https://github.com/topoteretes/cognee-community/issues/59
    Remove this patch when the issue is fixed.

    FalkorDB's Cypher parser only supports ASCII characters in property names.
    The stringify_properties method serializes property dicts to Cypher syntax,
    but doesn't sanitize property keys that may contain non-ASCII characters.

    This patch converts non-ASCII property keys to ASCII equivalents while
    preserving the original property values (which can contain any characters).
    """
    try:
        from cognee_community_hybrid_adapter_falkor.falkor_adapter import FalkorDBAdapter

        if getattr(FalkorDBAdapter, "_tale_stringify_properties_patch_applied", False):
            return

        _original_stringify_properties = FalkorDBAdapter.stringify_properties

        def _patched_stringify_properties(self: Any, properties: dict[str, Any]) -> str:
            """Convert properties to Cypher string with sanitized keys."""
            sanitized_properties = {}
            for key, value in properties.items():
                if value is not None:
                    sanitized_key = _sanitize_identifier_for_cypher(key, "prop")
                    sanitized_properties[sanitized_key] = value
            return _original_stringify_properties(self, sanitized_properties)

        FalkorDBAdapter.stringify_properties = _patched_stringify_properties
        FalkorDBAdapter._tale_stringify_properties_patch_applied = True
        logger.info("Patched FalkorDB adapter stringify_properties for ASCII property names")

    except ImportError as e:
        logger.debug(f"FalkorDB adapter not available, skipping stringify_properties patch: {e}")
    except Exception as e:
        logger.warning(f"Failed to patch FalkorDB adapter stringify_properties: {e}")


def _patch_falkordb_adapter_create_data_point_query() -> None:
    """Patch FalkorDB adapter to sanitize DataPoint class names used as node labels.

    Upstream: https://github.com/topoteretes/cognee-community/issues/59
    Remove this patch when the issue is fixed.

    The create_data_point_query method uses data_point.__class__.__name__ as the
    node label. If custom DataPoint subclasses have non-ASCII names, this causes
    Cypher parser errors.

    This patch sanitizes the class name in the generated query.
    """
    try:
        from cognee_community_hybrid_adapter_falkor.falkor_adapter import FalkorDBAdapter

        if getattr(FalkorDBAdapter, "_tale_create_data_point_query_patch_applied", False):
            return

        _original_create_data_point_query = FalkorDBAdapter.create_data_point_query

        def _patched_create_data_point_query(self: Any, data_point: Any) -> tuple[str, dict]:
            """Create data point query with sanitized node label."""
            query, params = _original_create_data_point_query(self, data_point)

            # Get the original class name and sanitize it
            original_label = data_point.__class__.__name__
            sanitized_label = _sanitize_identifier_for_cypher(original_label, "DataPoint")

            # Replace the label in the query if it changed
            if original_label != sanitized_label:
                # The query format is: MERGE (n:ClassName {id: $id}) SET n = $properties
                query = query.replace(f"(n:{original_label} ", f"(n:{sanitized_label} ")

            return query, params

        FalkorDBAdapter.create_data_point_query = _patched_create_data_point_query
        FalkorDBAdapter._tale_create_data_point_query_patch_applied = True
        logger.info("Patched FalkorDB adapter create_data_point_query for ASCII labels")

    except ImportError as e:
        logger.debug(f"FalkorDB adapter not available, skipping create_data_point_query patch: {e}")
    except Exception as e:
        logger.warning(f"Failed to patch FalkorDB adapter create_data_point_query: {e}")


def _patch_falkordb_adapter_add_nodes() -> None:
    """Patch FalkorDB adapter add_nodes to fix vector index bug.

    Upstream: https://github.com/topoteretes/cognee-community/issues/61
    Remove this patch when the issue is fixed.

    The original implementation has a bug where it uses enumerate(property_names)
    to index into vectorized_values, but vectorized_values only contains vectors
    for properties that have non-None values. This causes IndexError when some
    embeddable properties are None.

    Fix: Use vector_map to correctly map property names to their vector indices,
    and handle cases where embed_data returns empty results (all values filtered
    as empty/whitespace).
    """
    try:
        from cognee.infrastructure.databases.graph.graph_db_interface import DataPoint
        from cognee_community_hybrid_adapter_falkor.falkor_adapter import FalkorDBAdapter

        if getattr(FalkorDBAdapter, "_tale_add_nodes_patch_applied", False):
            return

        _original_add_nodes = FalkorDBAdapter.add_nodes

        # Global counter to track how many times add_nodes is called
        _add_nodes_call_count = {"count": 0, "total_nodes": 0}

        async def _patched_add_nodes(self: Any, nodes: list) -> None:
            """Add nodes with fixed vector index mapping and batched embeddings.

            Performance optimization: Collect all embeddable values from all nodes
            first, then embed them in one batched API call instead of one call per node.
            This reduces API overhead from hundreds of calls to just one.
            """
            # Track call statistics
            _add_nodes_call_count["count"] += 1
            _add_nodes_call_count["total_nodes"] += len(nodes)

            # Phase 1: Collect all embeddable values and build metadata
            tuple_nodes = []
            datapoint_nodes = []
            all_embeddable_values = []
            node_metadata = []

            for node in nodes:
                if isinstance(node, tuple) and len(node) == 2:
                    tuple_nodes.append(node)
                elif hasattr(node, "id") and hasattr(node, "model_dump"):
                    property_names = DataPoint.get_embeddable_property_names(node)
                    vector_map = {}
                    node_embeddable_values = []

                    for property_name in property_names:
                        property_value = getattr(node, property_name, None)
                        if property_value is not None:
                            vector_map[property_name] = len(all_embeddable_values) + len(node_embeddable_values)
                            node_embeddable_values.append(property_value)

                    all_embeddable_values.extend(node_embeddable_values)
                    datapoint_nodes.append(node)
                    node_metadata.append({
                        "node": node,
                        "vector_map": vector_map,
                        "num_values": len(node_embeddable_values)
                    })
                else:
                    raise ValueError(
                        f"Invalid node format: {node}. Expected tuple (node_id, properties) "
                        f"or DataPoint object."
                    )

            # Phase 2: Batch embed all values at once (huge performance improvement)
            all_vectorized_values = []
            if all_embeddable_values:
                logger.warning(
                    f"[PERF] add_nodes call #{_add_nodes_call_count['count']} "
                    f"({_add_nodes_call_count['total_nodes']} total nodes processed): "
                    f"batching {len(all_embeddable_values)} embeddings from {len(datapoint_nodes)} DataPoint nodes"
                )
                import time
                batch_start = time.time()
                all_vectorized_values = await self.embed_data(all_embeddable_values)
                batch_duration = time.time() - batch_start
                logger.warning(
                    f"[PERF] Batch #{_add_nodes_call_count['count']} complete: "
                    f"{len(all_vectorized_values)} vectors in {batch_duration:.2f}s "
                    f"({len(all_embeddable_values)/batch_duration:.1f} vectors/sec)"
                )

            # Phase 3: Add tuple nodes directly
            for node_id, properties in tuple_nodes:
                await self.add_node(node_id, properties)

            # Phase 4: Add DataPoint nodes with their vectors
            for metadata in node_metadata:
                node = metadata["node"]
                vector_map = metadata["vector_map"]

                properties = {**node.model_dump()}

                if vector_map and len(all_vectorized_values) >= max(vector_map.values()) + 1:
                    properties.update({
                        f"{property_name}_vector": all_vectorized_values[vector_idx]
                        for property_name, vector_idx in vector_map.items()
                    })
                elif vector_map:
                    logger.warning(
                        f"Vector embedding mismatch for node {node.id}: "
                        f"expected indices up to {max(vector_map.values())} but got {len(all_vectorized_values)} vectors. "
                        f"Properties: {list(vector_map.keys())}. Skipping vector properties."
                    )
                    if "metadata" in properties and "index_fields" in properties["metadata"]:
                        properties["metadata"]["index_fields"] = [
                            field for field in properties["metadata"]["index_fields"]
                            if field not in vector_map
                        ]

                await self.add_node(str(node.id), properties)

        FalkorDBAdapter.add_nodes = _patched_add_nodes
        FalkorDBAdapter._tale_add_nodes_patch_applied = True
        logger.info("Patched FalkorDB adapter add_nodes with batched embedding optimization")

    except ImportError as e:
        logger.debug(f"FalkorDB adapter not available, skipping add_nodes patch: {e}")
    except Exception as e:
        logger.warning(f"Failed to patch FalkorDB adapter add_nodes: {e}")


def setup_cognee_environment() -> None:
    """Set up environment variables for cognee BEFORE importing it.

    All required configuration must come from get_llm_config() which validates
    that required environment variables are set. No hardcoded defaults.

    Structured output framework:

    We default to BAML (``STRUCTURED_OUTPUT_FRAMEWORK=baml``) for structured
    outputs because BAML's schema-aligned parsing works well across a wide
    range of models without requiring native tool-calling support.

    Note on temperature: Cognee's default ``BAML_LLM_TEMPERATURE`` is 0.0,
    which newer models reject. We therefore set it to 1.0 (the model
    default) unless an operator explicitly overrides it.

    Raises:
        ValueError: If required environment variables are not set.
    """
    # get_llm_config() validates all required env vars and raises ValueError if missing
    llm_config = settings.get_llm_config()

    # These are guaranteed to be set by get_llm_config()
    openai_api_key = llm_config["api_key"]
    base_url = llm_config["base_url"]
    model = llm_config["model"]
    embedding_model = llm_config["embedding_model"]

    # For Cognee + LiteLLM, when using an OpenAI-compatible endpoint (like OpenRouter)
    # make sure the model string encodes the provider so LiteLLM can route correctly.
    # We ALWAYS add 'openai/' prefix for non-OpenAI endpoints because:
    # 1. LiteLLM uses the prefix to determine the API protocol (openai-compatible)
    # 2. OpenRouter model names like 'qwen/qwen3-embedding-4b' are NOT LiteLLM providers
    # 3. The 'openai/' prefix tells LiteLLM to use the OpenAI-compatible API at base_url
    cognee_llm_model = model
    cognee_embedding_model = embedding_model
    if "api.openai.com" not in base_url:
        # Always add openai/ prefix for non-OpenAI endpoints
        # This tells LiteLLM to use OpenAI-compatible protocol with OPENAI_BASE_URL
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

    # Set embedding dimensions for Cognee's vector storage
    # This must match the output dimensions of the embedding model
    embedding_dimensions = settings.get_embedding_dimensions()
    os.environ.setdefault("EMBEDDING_DIMENSIONS", str(embedding_dimensions))

    # Set chunk size for text chunking during cognify
    # This controls the maximum tokens per chunk (affects retrieval precision)
    # Default cognee value is 8191 which is too large for most RAG use cases
    os.environ.setdefault("EMBEDDING_MAX_COMPLETION_TOKENS", str(settings.chunk_size))

    # Configure BAML for structured outputs (knowledge graph extraction)
    # Use BAML_LLM_MODEL to specify a different model for extraction if needed.
    # This is useful when the main model is a "thinking" model that causes JSON truncation.
    # IMPORTANT: BAML sends requests directly to BAML_LLM_ENDPOINT (OpenRouter),
    # so it needs the ORIGINAL model name WITHOUT 'openai/' prefix.
    # (The 'openai/' prefix is only for LiteLLM's internal routing)
    baml_model = os.environ.get("BAML_LLM_MODEL") or model  # Use original model, not cognee_llm_model
    os.environ.setdefault("STRUCTURED_OUTPUT_FRAMEWORK", "baml")
    os.environ.setdefault("BAML_LLM_PROVIDER", provider)
    os.environ["BAML_LLM_MODEL"] = baml_model  # Use direct assignment to respect env override
    os.environ.setdefault("BAML_LLM_ENDPOINT", base_url)
    os.environ.setdefault("BAML_LLM_API_KEY", openai_api_key)
    os.environ.setdefault("BAML_LLM_TEMPERATURE", "1.0")

    # Export OPENAI_* for libraries that look at these env vars
    os.environ.setdefault("OPENAI_API_KEY", openai_api_key)
    os.environ.setdefault("OPENAI_BASE_URL", base_url)

    logger.info(
        "LLM configured - Provider: {}, Model: {}, Embedding: {} (dim={}), BAML: {}, chunk_size: {}",
        provider,
        cognee_llm_model,
        cognee_embedding_model,
        embedding_dimensions,
        baml_model,
        settings.chunk_size,
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
    """Set up vector and graph database configuration for Cognee.

    Uses FalkorDB for both graph and vector storage via the hybrid adapter.
    FalkorDB is a Redis-based graph database optimized for GraphRAG with:
    - Native multi-tenant support (10K+ graphs per instance)
    - Low latency (~140ms p99)
    - Client-server architecture (no file-level locking issues)
    - Combined graph and vector storage in one system
    """
    # FalkorDB connection settings (defaults for Docker network)
    # 'graph-db' is the Docker service name in compose.yml
    falkordb_url = os.environ.get("GRAPH_DATABASE_URL", "graph-db")
    falkordb_port = os.environ.get("GRAPH_DATABASE_PORT", "6379")

    # Use FalkorDB for graph storage
    # Note: Cognee expects provider name "falkor" (not "falkordb")
    os.environ["GRAPH_DATABASE_PROVIDER"] = "falkor"
    os.environ["GRAPH_DATABASE_URL"] = falkordb_url
    os.environ["GRAPH_DATABASE_PORT"] = falkordb_port
    # Set the dataset handler for multi-user access control mode
    os.environ["GRAPH_DATASET_DATABASE_HANDLER"] = "falkor_graph_local"

    # Use FalkorDB for vector storage (hybrid adapter handles both)
    os.environ["VECTOR_DB_PROVIDER"] = "falkor"
    os.environ["VECTOR_DB_URL"] = falkordb_url
    os.environ["VECTOR_DB_PORT"] = falkordb_port
    # Set the dataset handler for multi-user access control mode
    os.environ["VECTOR_DATASET_DATABASE_HANDLER"] = "falkor_vector_local"

    logger.info(
        "Configured Cognee to use FalkorDB (graph + vector) at {}:{}",
        falkordb_url,
        falkordb_port,
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

    # FalkorDB handles multi-tenancy natively via separate graphs per dataset.
    # No need for file-based isolation (ENABLE_BACKEND_ACCESS_CONTROL) since
    # FalkorDB is a centralized client-server database, not embedded files.

    # Set cognee data directory (still needed for temp files and document processing)
    os.environ["COGNEE_DATA_DIR"] = settings.cognee_data_dir


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
    configure_litellm_drop_params()
    _patch_litellm_aembedding()
    _patch_litellm_embedding()
    _patch_falkordb_adapter_relationship_sanitize()
    _patch_falkordb_adapter_add_node()
    _patch_falkordb_adapter_stringify_properties()
    _patch_falkordb_adapter_create_data_point_query()
    _patch_falkordb_adapter_add_nodes()
    setup_cognee_environment()
    configure_cognee_base_config()

    try:
        import cognee  # noqa: F401
        logger.info("Cognee imported successfully with preconfigured base_config")
        return True
    except ImportError:
        logger.warning("cognee package not available")
        return False


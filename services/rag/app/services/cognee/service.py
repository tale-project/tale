"""Cognee service wrapper for Tale RAG.

This module provides the main CogneeService class that wraps
cognee RAG operations.
"""

import time
from typing import Any, Optional

import cognee
from loguru import logger
from openai import AsyncOpenAI

from ...config import settings
from .cleanup import cleanup_legacy_site_packages_data, cleanup_missing_local_files_data
from .utils import normalize_add_result, normalize_search_results

# Use a single logical dataset for Tale documents by default.
# This avoids creating a separate Cognee dataset for every document_id,
# which can increase memory usage and management overhead when ingesting
# thousands of small documents.
DEFAULT_COGNEE_DATASET_NAME = "tale_documents"


class CogneeService:
    """Service wrapper for cognee RAG operations."""

    def __init__(self) -> None:
        """Initialize the cognee service."""
        self.initialized = False

    async def initialize(self) -> None:
        """Initialize cognee with configuration."""
        try:
            # Cognee 0.3.5+ uses environment variables for configuration
            # All configuration is done in config.py at import time
            # Mark as initialized - cognee will auto-initialize on first use

            # Clean up any legacy data rows that still point at the old
            # site-packages/.data_storage path so cognify() doesn't crash
            # on missing files created by previous container builds.
            await cleanup_legacy_site_packages_data()

            # Also clean up rows that reference local files under the current
            # data_root_directory whose underlying files no longer exist (for
            # example after rebuilding the container without a persistent
            # volume mounted at /app/data).
            await cleanup_missing_local_files_data()

            self.initialized = True
            logger.info("Cognee initialized successfully")

        except Exception as e:
            logger.error(f"Failed to initialize cognee: {e}")
            raise

    async def add_document(
        self,
        content: str,
        metadata: Optional[dict[str, Any]] = None,
        document_id: Optional[str] = None,
    ) -> dict[str, Any]:
        """Add a document to the knowledge base.

        Args:
            content: Document content
            metadata: Optional metadata (reserved for future use)
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

            doc_id, chunks_created = normalize_add_result(result, document_id)

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
        _filters: Optional[dict[str, Any]] = None,
    ) -> list[dict[str, Any]]:
        """Search the knowledge base.

        Args:
            query: Search query
            top_k: Number of results to return
            similarity_threshold: Minimum similarity score
            _filters: Optional metadata filters (reserved for future use)

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
            normalized_results = normalize_search_results(raw_results)

            # Filter by similarity threshold if specified
            threshold = similarity_threshold or settings.similarity_threshold
            filtered_results = [
                r for r in normalized_results if r.get("score", 0) >= threshold
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
    ) -> dict[str, Any]:
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

            # Build context from search results
            context_parts = []
            for i, result in enumerate(search_results, 1):
                content = result.get("content", "")
                if content:
                    context_parts.append(f"[{i}] {content}")

            context = "\n\n".join(context_parts) if context_parts else ""

            # Build the system prompt for RAG
            default_system_prompt = (
                "You are a helpful assistant that answers questions based on the provided context. "
                "Use the context to answer the user's question accurately. "
                "If the context doesn't contain relevant information, say so."
            )
            final_system_prompt = system_prompt or default_system_prompt

            # Build the user message with context
            if context:
                user_message = f"Context:\n{context}\n\nQuestion: {query}"
            else:
                user_message = query

            # Get LLM configuration
            llm_config = settings.get_llm_config()

            # Create OpenAI client with timeout
            client = AsyncOpenAI(
                api_key=llm_config.get("api_key"),
                base_url=llm_config.get("base_url"),
                timeout=60.0,  # 60 second timeout to prevent hanging requests
            )

            # Build completion kwargs
            completion_kwargs: dict[str, Any] = {
                "model": llm_config.get("model", "gpt-4o"),
                "messages": [
                    {"role": "system", "content": final_system_prompt},
                    {"role": "user", "content": user_message},
                ],
            }

            # Add optional parameters
            if temperature is not None:
                completion_kwargs["temperature"] = temperature
            elif llm_config.get("temperature") is not None:
                completion_kwargs["temperature"] = llm_config["temperature"]

            if max_tokens is not None:
                completion_kwargs["max_tokens"] = max_tokens
            elif llm_config.get("max_tokens") is not None:
                completion_kwargs["max_tokens"] = llm_config["max_tokens"]

            # Generate response using OpenAI client
            completion = await client.chat.completions.create(**completion_kwargs)
            if not completion.choices:
                raise ValueError("LLM returned empty choices array")
            response = completion.choices[0].message.content or ""

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

    async def delete_document(self, document_id: str) -> dict[str, Any]:
        """Delete a document from the knowledge base.

        Args:
            document_id: ID of the document to delete

        Returns:
            Dictionary with operation results

        Note:
            Document deletion is not yet implemented in cognee.
            This method returns success=False to indicate the operation was not performed.
        """
        if not self.initialized:
            await self.initialize()

        # Note: cognee does not currently support direct delete by document ID.
        # Return success=False to indicate the operation was not performed.
        logger.warning(f"Delete operation for {document_id} - not implemented in cognee")

        return {
            "success": False,
            "message": f"Document deletion is not yet supported. Document {document_id} was not deleted.",
        }

    async def reset(self) -> None:
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


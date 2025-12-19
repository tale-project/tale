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
            document_id: Optional custom document ID (used for tagging and later deletion)

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

            # Use node_set to tag the document with our document_id for later deletion
            # This allows us to find and delete documents by their external ID
            node_set = [document_id] if document_id else None

            result = await cognee.add(
                content,
                dataset_name=dataset_name,
                node_set=node_set,
            )

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



    async def delete_document(self, document_id: str, mode: str = "hard") -> dict[str, Any]:
        """Delete a document from the knowledge base by document ID.

        This method finds documents in Cognee that were tagged with the given
        document_id in their node_set, then deletes them along with their
        associated knowledge graph nodes and vector embeddings.

        Args:
            document_id: ID of the document to delete (must match the ID used when adding)
            mode: "soft" or "hard" - "hard" (default) also deletes degree-one entity nodes

        Returns:
            Dictionary with operation results including:
            - success: Whether deletion was successful
            - deleted_count: Number of documents deleted
            - deleted_data_ids: List of Cognee Data IDs that were deleted
            - message: Status message
        """
        if not self.initialized:
            await self.initialize()

        try:
            start_time = time.time()

            # Import Cognee internals for data lookup
            import json
            from uuid import UUID
            from sqlalchemy import select
            from cognee.infrastructure.databases.relational import get_relational_engine
            from cognee.modules.data.models import Data, Dataset, DatasetData
            from cognee.api.v1.delete import delete as cognee_delete

            logger.info(f"Looking for documents with node_set containing: {document_id}")

            # Find Data records with matching node_set
            db_engine = get_relational_engine()
            async with db_engine.get_async_session() as session:
                # Query all Data records and filter by node_set containing document_id
                result = await session.execute(select(Data))
                all_data = result.scalars().all()

                matching_data = []
                for data in all_data:
                    if data.node_set:
                        try:
                            # node_set is stored as JSON string
                            node_set = (
                                json.loads(data.node_set)
                                if isinstance(data.node_set, str)
                                else data.node_set
                            )
                            if document_id in node_set:
                                matching_data.append(data)
                        except (json.JSONDecodeError, TypeError):
                            continue

                if not matching_data:
                    processing_time = (time.time() - start_time) * 1000
                    logger.info(
                        f"No documents found with node_set containing '{document_id}'"
                    )
                    return {
                        "success": True,
                        "message": f"No documents found with ID '{document_id}'",
                        "deleted_count": 0,
                        "deleted_data_ids": [],
                        "processing_time_ms": processing_time,
                    }

                logger.info(
                    f"Found {len(matching_data)} document(s) with node_set containing '{document_id}'"
                )

                # Get the dataset for these documents
                deleted_data_ids = []
                for data in matching_data:
                    # Find the dataset this data belongs to
                    dataset_link = (
                        await session.execute(
                            select(DatasetData).where(DatasetData.data_id == data.id)
                        )
                    ).scalars().first()

                    if dataset_link:
                        dataset_id = dataset_link.dataset_id
                        try:
                            # Use Cognee's delete function
                            await cognee_delete(
                                data_id=data.id,
                                dataset_id=dataset_id,
                                mode=mode,
                            )
                            deleted_data_ids.append(str(data.id))
                            logger.info(f"Deleted document: {data.id}")
                        except Exception as e:
                            logger.error(f"Failed to delete document {data.id}: {e}")
                    else:
                        logger.warning(
                            f"Document {data.id} has no dataset link, skipping"
                        )

            processing_time = (time.time() - start_time) * 1000
            logger.info(
                f"Deleted {len(deleted_data_ids)} document(s) in {processing_time:.2f}ms"
            )

            return {
                "success": True,
                "message": f"Deleted {len(deleted_data_ids)} document(s) with ID '{document_id}'",
                "deleted_count": len(deleted_data_ids),
                "deleted_data_ids": deleted_data_ids,
                "processing_time_ms": processing_time,
            }

        except ImportError as e:
            logger.error(f"Cognee deletion modules not available: {e}")
            return {
                "success": False,
                "message": f"Cognee deletion modules not available: {e}",
                "deleted_count": 0,
                "deleted_data_ids": [],
                "processing_time_ms": None,
            }
        except Exception as e:
            logger.error(f"Failed to delete document: {e}")
            raise

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


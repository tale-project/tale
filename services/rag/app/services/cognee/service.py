"""Cognee service wrapper for Tale RAG.

This module provides the main CogneeService class that wraps
cognee RAG operations.
"""

import asyncio
import os
import time
from pathlib import Path
from typing import Any, Optional
from uuid import uuid4

import aiofiles
import cognee
from cognee import SearchType
from loguru import logger
from openai import AsyncOpenAI

from ...config import settings
from ...models import SearchType as ApiSearchType
from ..vision import extract_text_from_document, is_vision_supported
from .cleanup import cleanup_legacy_site_packages_data, cleanup_missing_local_files_data
from .utils import normalize_add_result, normalize_search_results


def _map_api_search_type_to_cognee(search_type: ApiSearchType | None) -> SearchType:
    """Map API SearchType to Cognee SearchType.

    Args:
        search_type: API search type enum value

    Returns:
        Corresponding Cognee SearchType
    """
    if search_type is None:
        return SearchType.CHUNKS  # Default to CHUNKS for raw text retrieval

    mapping = {
        ApiSearchType.CHUNKS: SearchType.CHUNKS,
        ApiSearchType.GRAPH_COMPLETION: SearchType.GRAPH_COMPLETION,
        ApiSearchType.RAG_COMPLETION: SearchType.RAG_COMPLETION,
        ApiSearchType.SUMMARIES: SearchType.SUMMARIES,
        ApiSearchType.GRAPH_SUMMARY_COMPLETION: SearchType.GRAPH_SUMMARY_COMPLETION,
        ApiSearchType.TEMPORAL: SearchType.TEMPORAL,
    }
    return mapping.get(search_type, SearchType.CHUNKS)

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
            content: Path to the document file to ingest
            metadata: Optional metadata (reserved for future use)
            document_id: Optional custom document ID (used for tagging and later deletion)

        Returns:
            Dictionary with operation results
        """
        if not self.initialized:
            await self.initialize()

        # Track temporary files created by Vision processing for cleanup
        vision_temp_file: Optional[str] = None

        try:
            start_time = time.time()
            timeout_seconds = settings.ingestion_timeout_seconds

            # Add document to cognee. We use a shared logical dataset instead of
            # creating one dataset per document_id to keep Cognee's in-memory
            # structures bounded even when ingesting many small documents.
            dataset_name = DEFAULT_COGNEE_DATASET_NAME

            # Use node_set to tag the document with our document_id for later deletion
            # This allows us to find and delete documents by their external ID
            node_set = [document_id] if document_id else None

            logger.info(
                f"Starting document ingestion for {document_id or 'unknown'} "
                f"(timeout: {timeout_seconds}s)"
            )

            # Pre-process PDFs and images with Vision API
            # This extracts text using OpenAI Vision instead of Tesseract OCR
            file_to_ingest = content
            if Path(content).exists() and is_vision_supported(content):
                logger.info(f"Pre-processing with Vision API: {content}")
                extracted_text, was_processed = await extract_text_from_document(content)

                if extracted_text and was_processed:
                    # Save extracted text to a temp file for cognee
                    ingest_dir = os.path.join(settings.cognee_data_dir, "ingest")
                    os.makedirs(ingest_dir, exist_ok=True)
                    vision_temp_file = os.path.join(
                        ingest_dir, f"vision_{uuid4().hex}.txt"
                    )
                    async with aiofiles.open(
                        vision_temp_file, "w", encoding="utf-8"
                    ) as f:
                        await f.write(extracted_text)

                    file_to_ingest = vision_temp_file
                    logger.info(
                        f"Vision extraction complete: {len(extracted_text)} chars "
                        f"saved to {vision_temp_file}"
                    )

            # Wrap cognee.add() with timeout
            try:
                result = await asyncio.wait_for(
                    cognee.add(
                        file_to_ingest,
                        dataset_name=dataset_name,
                        node_set=node_set,
                    ),
                    timeout=timeout_seconds,
                )
            except asyncio.TimeoutError:
                elapsed = time.time() - start_time
                error_msg = (
                    f"cognee.add() timed out after {elapsed:.1f}s "
                    f"(limit: {timeout_seconds}s) for document {document_id or 'unknown'}"
                )
                logger.error(error_msg)
                raise TimeoutError(error_msg)

            logger.info(f"cognee.add() completed for {document_id or 'unknown'}")

            # Process the document with incremental loading to only process new/updated data.
            # This avoids reprocessing the entire dataset on each call.
            # Wrap cognee.cognify() with timeout (remaining time from original timeout)
            elapsed_so_far = time.time() - start_time
            remaining_timeout = max(60, timeout_seconds - elapsed_so_far)  # At least 60s for cognify

            logger.info(
                f"Starting cognee.cognify() for {document_id or 'unknown'} "
                f"(remaining timeout: {remaining_timeout:.0f}s)"
            )

            try:
                await asyncio.wait_for(
                    cognee.cognify(
                        datasets=[dataset_name],
                        incremental_loading=True,
                    ),
                    timeout=remaining_timeout,
                )
            except asyncio.TimeoutError:
                elapsed = time.time() - start_time
                error_msg = (
                    f"cognee.cognify() timed out after {elapsed:.1f}s "
                    f"(limit: {timeout_seconds}s) for document {document_id or 'unknown'}"
                )
                logger.error(error_msg)
                raise TimeoutError(error_msg)

            processing_time = (time.time() - start_time) * 1000
            logger.info(f"Document added in {processing_time:.2f}ms")

            doc_id, chunks_created = normalize_add_result(result, document_id)

            return {
                "success": True,
                "document_id": doc_id,
                "chunks_created": chunks_created,
                "processing_time_ms": processing_time,
            }

        except TimeoutError:
            # Re-raise timeout errors without wrapping
            raise
        except Exception as e:
            logger.error(f"Failed to add document: {e}")
            raise
        finally:
            # Clean up Vision temp file if created
            if vision_temp_file and os.path.exists(vision_temp_file):
                try:
                    os.unlink(vision_temp_file)
                    logger.debug(f"Cleaned up Vision temp file: {vision_temp_file}")
                except OSError as cleanup_exc:
                    logger.warning(
                        f"Failed to clean up Vision temp file: {cleanup_exc}"
                    )

    async def search(
        self,
        query: str,
        search_type: ApiSearchType | None = None,
        top_k: Optional[int] = None,
        similarity_threshold: Optional[float] = None,
        _filters: Optional[dict[str, Any]] = None,
    ) -> list[dict[str, Any]]:
        """Search the knowledge base.

        Args:
            query: Search query
            search_type: Type of search to perform (CHUNKS, GRAPH_COMPLETION, etc.)
                         Defaults to CHUNKS for raw text chunk retrieval.
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

            # Map API search type to Cognee search type
            cognee_search_type = _map_api_search_type_to_cognee(search_type)

            logger.info(
                f"Searching with type={cognee_search_type.value}, query='{query[:50]}...'"
            )

            # Use cognee search with specified search type
            raw_results = await cognee.search(
                query,
                query_type=cognee_search_type,
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
            error_type = type(e).__name__

            # Handle "DatabaseNotCreatedError" - this happens when no documents
            # have been added yet. Return an empty list instead of failing.
            if "DatabaseNotCreatedError" in error_str or "database has not been created" in error_str.lower():
                logger.info(
                    "No documents have been indexed yet. "
                    "Search returning empty results. Add documents first using /api/v1/documents."
                )
                return []

            # Handle BamlValidationError - this happens when the knowledge graph
            # has no relevant nodes/connections for the query. The LLM returns
            # an empty response which BAML fails to parse. Return empty results.
            if error_type == "BamlValidationError" or "BamlValidationError" in error_str:
                logger.info(
                    f"No relevant context found in knowledge graph for query: '{query}'. "
                    "Search returning empty results."
                )
                return []

            # Handle empty LLM response - can happen when context is empty
            if "Failed to parse LLM response" in error_str or "Failed to coerce value" in error_str:
                logger.info(
                    f"LLM returned empty/invalid response for query: '{query}'. "
                    "This typically means no relevant data exists in the knowledge graph. "
                    "Search returning empty results."
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
            from sqlalchemy import select, cast, String
            from cognee.infrastructure.databases.relational import get_relational_engine
            from cognee.modules.data.models import Data, Dataset, DatasetData
            from cognee.api.v1.delete import delete as cognee_delete

            logger.info(f"Looking for documents with node_set containing: {document_id}")

            # Find Data records with matching node_set
            db_engine = get_relational_engine()
            async with db_engine.get_async_session() as session:
                # Use database-level filtering to find documents with matching node_set
                # node_set is stored as a JSON array string, so we use LIKE for text search
                # This is more efficient than loading all records into memory
                # Filter at database level - node_set contains the document_id in the JSON array
                # The document_id appears as a quoted string in the JSON array: ["document_id"]
                result = await session.execute(
                    select(Data).where(
                        cast(Data.node_set, String).contains(document_id)
                    )
                )
                matching_data = result.scalars().all()

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
        """Reset the knowledge base (delete all data).

        This clears all documents, embeddings, knowledge graph data, and system metadata.
        After reset, the service will re-initialize on next use.
        """
        if not self.initialized:
            await self.initialize()

        try:
            # Step 1: Try cognee's built-in prune functions first
            logger.info("Starting knowledge base reset...")

            try:
                await cognee.prune.prune_system(graph=True, vector=True, metadata=True, cache=True)
                logger.info("Cognee prune_system completed")
            except Exception as e:
                logger.warning(f"Cognee prune_system failed (continuing): {e}")

            try:
                await cognee.prune.prune_data()
                logger.info("Cognee prune_data completed")
            except Exception as e:
                logger.warning(f"Cognee prune_data failed (continuing): {e}")

            # Step 2: Direct cleanup of PGVector tables (fallback)
            # This ensures vector data is deleted even if cognee's prune fails
            await self._cleanup_pgvector_tables()

            # Step 3: Direct cleanup of graph database
            await self._cleanup_graph_database()

            # Reset initialized state so service re-initializes on next use
            self.initialized = False

            logger.info("Knowledge base reset successfully")

        except Exception as e:
            logger.error(f"Failed to reset knowledge base: {e}")
            raise

    async def _cleanup_pgvector_tables(self) -> None:
        """Directly drop all Cognee-related tables from PostgreSQL.

        This is a fallback cleanup that ensures vector data is removed
        even if cognee's prune functions don't work correctly.
        """
        try:
            from sqlalchemy import text
            from cognee.infrastructure.databases.relational import get_relational_engine

            db_engine = get_relational_engine()

            async with db_engine.get_async_session() as session:
                # Get list of all tables in the database
                result = await session.execute(
                    text(
                        "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
                    )
                )
                tables = [row[0] for row in result.fetchall()]

                # Tables to preserve (system tables, etc.)
                # We want to delete cognee-specific tables
                preserved_tables: set[str] = set()

                # Drop cognee-related tables
                dropped_count = 0
                for table_name in tables:
                    if table_name in preserved_tables:
                        continue

                    try:
                        await session.execute(
                            text(f'DROP TABLE IF EXISTS "{table_name}" CASCADE')
                        )
                        dropped_count += 1
                        logger.debug(f"Dropped table: {table_name}")
                    except Exception as e:
                        logger.warning(f"Failed to drop table {table_name}: {e}")

                await session.commit()
                logger.info(f"Dropped {dropped_count} PostgreSQL tables")

        except Exception as e:
            logger.warning(f"PGVector cleanup failed (continuing): {e}")

    async def _cleanup_graph_database(self) -> None:
        """Clear all data from the Kuzu graph database.

        Sends Cypher queries to delete all nodes and relationships.
        """
        try:
            import httpx

            from ...config import settings

            graph_url = settings.graph_db_url

            async with httpx.AsyncClient(timeout=30.0) as client:
                # Delete all relationships first, then all nodes
                # Kuzu uses Cypher-like syntax
                queries = [
                    "MATCH ()-[r]->() DELETE r",  # Delete all relationships
                    "MATCH (n) DELETE n",  # Delete all nodes
                ]

                for query in queries:
                    try:
                        response = await client.post(
                            f"{graph_url}/query",
                            json={"query": query},
                        )
                        if response.status_code == 200:
                            logger.debug(f"Graph query executed: {query}")
                        else:
                            logger.warning(
                                f"Graph query failed: {query}, status: {response.status_code}"
                            )
                    except Exception as e:
                        logger.warning(f"Graph query failed: {query}, error: {e}")

                logger.info("Graph database cleanup completed")

        except Exception as e:
            logger.warning(f"Graph database cleanup failed (continuing): {e}")


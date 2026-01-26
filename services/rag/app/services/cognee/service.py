"""Cognee service wrapper for Tale RAG.

This module provides the main CogneeService class that wraps
cognee RAG operations.
"""

import asyncio
import logging
import os
import time
from pathlib import Path
from typing import Any
from uuid import uuid4

import aiofiles
import cognee
from cognee import SearchType
from cognee.infrastructure.databases.relational import get_relational_engine
from cognee.modules.data.models import Data, Dataset, DatasetData
from loguru import logger
from openai import AsyncOpenAI
from sqlalchemy import String, cast, delete as sql_delete, select
from tenacity import (
    AsyncRetrying,
    before_sleep_log,
    stop_after_attempt,
    wait_exponential,
)

from ...config import settings
from ...models import SearchType as ApiSearchType
from ..vision import extract_text_from_document, is_vision_supported
from .cleanup import (
    cleanup_legacy_site_packages_data,
    cleanup_missing_local_files_data,
    migrate_vector_dimensions,
)
from .tenant_manager import get_or_create_team_context, get_or_create_user_for_context
from .utils import (
    compute_file_hash,
    extract_team_id_from_dataset,
    normalize_add_result,
    normalize_search_results,
)

# Standard logging adapter for tenacity (it doesn't support loguru directly)
_std_logger = logging.getLogger(__name__)


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

# Default prompt for knowledge graph extraction - enforces English identifiers
# for FalkorDB compatibility (Cypher parser only supports ASCII in identifiers)
DEFAULT_GRAPH_EXTRACTION_PROMPT = """
Extract entities and relationships from the provided text content.

CRITICAL REQUIREMENTS for FalkorDB compatibility:
1. ALL entity type names (node labels) MUST be in English using PascalCase
   (e.g., Person, Organization, Document, Concept)
2. ALL relationship type names MUST be in English using UPPER_SNAKE_CASE
   (e.g., WORKS_FOR, LOCATED_IN, RELATED_TO)
3. ALL property names MUST be in English using snake_case (e.g., name, description, created_at)
4. Property VALUES can be in any language (Chinese, etc.) - only the keys must be English

Examples:
- Entity type: "Person" (not "人物"), "Organization" (not "组织"), "Document" (not "文档")
- Relationship: "BELONGS_TO" (not "属于"), "CREATED_BY" (not "创建者")
- Property: {"name": "张三", "description": "这是中文描述"} (keys in English, values can be Chinese)

Focus on extracting meaningful entities and their relationships while strictly following the naming conventions above.
"""

# System prompt for GRAPH_COMPLETION search - generates detailed, comprehensive answers
DEFAULT_GRAPH_COMPLETION_PROMPT = """You are a knowledgeable assistant that provides \
comprehensive answers based on the provided context.

Instructions:
1. Provide detailed and thorough answers based on the context
2. Include specific information, policy details, and key points from the source documents
3. If there are specific clauses, regulations, or procedures mentioned, include them
4. Structure your answer clearly with sections if the topic has multiple aspects
5. Respond in the same language as the user's question
6. If the context is insufficient, clearly state what information is missing
7. Do not make up information - only use what is provided in the context

Your goal is to give the user a complete understanding of the topic, not just a brief summary.
"""


class CogneeService:
    """Service wrapper for cognee RAG operations."""

    def __init__(self) -> None:
        """Initialize the cognee service."""
        self.initialized = False
        # Cached LLM configuration and reusable OpenAI client
        # Created once during initialize() to avoid per-request overhead
        self._llm_config: dict[str, Any] | None = None
        self._openai_client: AsyncOpenAI | None = None
        # Note: FalkorDB is client-server architecture, no file-level locking
        # issues like Kuzu had. No need for per-dataset initialization locks.

    async def initialize(self) -> None:
        """Initialize cognee with configuration."""
        try:
            # Cognee 0.3.5+ uses environment variables for configuration
            # All configuration is done in config.py at import time
            # Mark as initialized - cognee will auto-initialize on first use

            # Check and migrate vector tables if embedding dimensions have changed.
            # This must run BEFORE any document ingestion to prevent dimension
            # mismatch errors like "expected 3072 dimensions, not 2560".
            await migrate_vector_dimensions()

            # Clean up any legacy data rows that still point at the old
            # site-packages/.data_storage path so cognify() doesn't crash
            # on missing files created by previous container builds.
            await cleanup_legacy_site_packages_data()

            # Also clean up rows that reference local files under the current
            # data_root_directory whose underlying files no longer exist (for
            # example after rebuilding the container without a persistent
            # volume mounted at /app/data).
            await cleanup_missing_local_files_data()

            # Cache LLM configuration and create reusable OpenAI client
            # This avoids per-request overhead from config parsing and connection setup
            self._llm_config = settings.get_llm_config()
            self._openai_client = AsyncOpenAI(
                api_key=self._llm_config["api_key"],
                base_url=self._llm_config["base_url"],
                timeout=60.0,
            )
            logger.info("OpenAI client initialized with connection pooling")

            self.initialized = True
            logger.info("Cognee initialized successfully")

        except Exception as e:
            logger.error(f"Failed to initialize cognee: {e}")
            raise

    async def get_document_datasets(self, document_id: str) -> list[dict[str, Any]]:
        """Query all datasets that contain a document.

        Finds all Data records containing the given document_id in their node_set,
        and returns dataset information for each record.

        Args:
            document_id: The document ID to search for

        Returns:
            List of dicts, each containing:
            - data_id: UUID
            - dataset_id: UUID
            - dataset_name: str
            - content_hash: str | None (for deduplication)
        """
        if not self.initialized:
            await self.initialize()

        try:
            import asyncpg
            from urllib.parse import urlparse

            db_url = settings.get_database_url()
            parsed = urlparse(db_url)

            conn = await asyncpg.connect(
                host=parsed.hostname or "localhost",
                port=parsed.port or 5432,
                database=parsed.path.lstrip("/") if parsed.path else "",
                user=parsed.username or "",
                password=parsed.password or "",
            )
            try:
                # Use raw SQL to get document datasets with original_content_hash
                # SQLAlchemy ORM doesn't know about our custom column
                rows = await conn.fetch(
                    """
                    SELECT d.id as data_id, dd.dataset_id, ds.name as dataset_name, d.original_content_hash
                    FROM data d
                    JOIN dataset_data dd ON d.id = dd.data_id
                    JOIN datasets ds ON dd.dataset_id = ds.id
                    WHERE d.node_set::text LIKE $1
                    """,
                    f'%{document_id}%',
                )

                entries = []
                for row in rows:
                    entries.append({
                        "data_id": row["data_id"],
                        "dataset_id": row["dataset_id"],
                        "dataset_name": row["dataset_name"] or "unknown",
                        "original_content_hash": row["original_content_hash"],
                    })

                return entries
            finally:
                await conn.close()

        except Exception as e:
            logger.warning(f"Failed to get document datasets for '{document_id}': {e}")
            return []

    async def _save_original_content_hash(
        self,
        document_id: str,
        content_hash: str,
    ) -> None:
        """Save the original content hash to the data record.

        Args:
            document_id: The document identifier (stored in node_set)
            content_hash: SHA-256 hash of the original uploaded file
        """
        import asyncpg
        from urllib.parse import urlparse

        db_url = settings.get_database_url()
        parsed = urlparse(db_url)

        conn = await asyncpg.connect(
            host=parsed.hostname or "localhost",
            port=parsed.port or 5432,
            database=parsed.path.lstrip("/") if parsed.path else "",
            user=parsed.username or "",
            password=parsed.password or "",
        )
        try:
            # Ensure column exists (lazy migration - handles case where data table
            # was created after startup migration ran)
            column_exists = await conn.fetchval("""
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'data' AND column_name = 'original_content_hash'
                )
            """)
            if not column_exists:
                await conn.execute("""
                    ALTER TABLE data ADD COLUMN original_content_hash VARCHAR
                """)
                logger.info("Added 'original_content_hash' column to data table (lazy migration)")

            # Use raw SQL to update the column (bypasses SQLAlchemy model validation)
            # node_set is JSON, use simple LIKE pattern without quotes
            result = await conn.execute(
                """
                UPDATE data
                SET original_content_hash = $1
                WHERE node_set::text LIKE $2
                """,
                content_hash,
                f'%{document_id}%',
            )
            logger.debug(f"Saved original_content_hash for document '{document_id}': {result}")
        finally:
            await conn.close()

    async def _delete_sql_data_entry(
        self,
        data_id: Any,
        dataset_id: Any,
    ) -> bool:
        """Delete a single Data record from SQL database only.

        This is used for cleanup during document re-indexing (add_document).
        For full deletion including graph/vector data, use delete_document instead.

        Args:
            data_id: Cognee Data record UUID
            dataset_id: Dataset UUID

        Returns:
            Whether deletion was successful
        """
        try:
            db_engine = get_relational_engine()
            async with db_engine.get_async_session() as session:
                await session.execute(
                    sql_delete(DatasetData).where(
                        DatasetData.data_id == data_id,
                        DatasetData.dataset_id == dataset_id,
                    )
                )
                remaining = (
                    await session.execute(
                        select(DatasetData).where(DatasetData.data_id == data_id)
                    )
                ).scalars().first()
                if not remaining:
                    await session.execute(
                        sql_delete(Data).where(Data.id == data_id)
                    )
                await session.commit()
            logger.info(f"Deleted SQL data entry: {data_id} from dataset: {dataset_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to delete SQL data entry {data_id}: {e}")
            return False

    async def add_document(
        self,
        content: str,
        metadata: dict[str, Any] | None = None,
        document_id: str | None = None,
        user_id: str | None = None,
        team_ids: list[str] | None = None,
    ) -> dict[str, Any]:
        """Add a document to the knowledge base.

        Args:
            content: Path to the document file to ingest
            metadata: Optional metadata (reserved for future use)
            document_id: Optional custom document ID (used for tagging and later deletion)
            user_id: Optional user ID for user-level isolation. If provided, operations
                     are scoped to this user's context. Takes priority over team-level isolation.
            team_ids: List of team IDs to add the document to (required). The document will
                      be added to each team's dataset (tale_team_{team_id}), allowing members
                      of all specified teams to search for this document.

        Returns:
            Dictionary with operation results
        """
        if not self.initialized:
            await self.initialize()

        # Track temporary files created by Vision processing for cleanup
        vision_temp_file: str | None = None

        try:
            start_time = time.time()
            timeout_seconds = settings.ingestion_timeout_seconds

            # Determine target datasets
            # Upload: user_id and team_ids are mutually exclusive
            # user_id takes priority (private document)
            target_datasets: list[str] = []
            if user_id:
                # Private document: user-specific dataset
                from .tenant_manager import string_to_uuid
                user_dataset = f"tale_user_{str(string_to_uuid(user_id))[:16]}"
                target_datasets.append(user_dataset)
                logger.info(f"Using user dataset '{user_dataset}' for private document (user_id={user_id})")
            elif team_ids and len(team_ids) > 0:
                # Shared document: team datasets
                from .utils import sanitize_team_id
                for tid in team_ids:
                    sanitized_tid = sanitize_team_id(tid)
                    if sanitized_tid:
                        target_datasets.append(f"tale_team_{sanitized_tid}")

            if not target_datasets:
                # Fallback for backwards compatibility (shouldn't happen with required team_ids)
                target_datasets = [DEFAULT_COGNEE_DATASET_NAME]
                logger.warning("No valid team_ids provided, using default dataset")

            # For backwards compatibility, use first dataset as "effective"
            effective_dataset_name = target_datasets[0] if target_datasets else DEFAULT_COGNEE_DATASET_NAME

            # Compute content hash for deduplication (hash of original uploaded file)
            new_content_hash: str | None = None
            if Path(content).exists():
                new_content_hash = await compute_file_hash(content)
                logger.debug(f"Computed content hash for {document_id or 'unknown'}: {new_content_hash[:16]}...")

            # Check for existing documents and handle deduplication
            cleaned_datasets: list[str] = []
            if document_id:
                existing_entries = await self.get_document_datasets(document_id)
                for entry in existing_entries:
                    if entry["dataset_name"] != effective_dataset_name:
                        # Different dataset: delete old SQL record (team assignment changed)
                        # Note: We only delete SQL here; graph/vector will be orphaned but
                        # overwritten when new document is indexed. For full cleanup use
                        # delete_document API.
                        success = await self._delete_sql_data_entry(
                            entry["data_id"],
                            entry["dataset_id"],
                        )
                        if success:
                            cleaned_datasets.append(entry["dataset_name"])
                            logger.info(
                                f"Cleaned up document '{document_id}' from old dataset: {entry['dataset_name']}"
                            )
                    else:
                        # Same dataset: check content hash for deduplication
                        existing_hash = entry.get("original_content_hash")
                        if existing_hash and new_content_hash and existing_hash == new_content_hash:
                            # Content unchanged, skip re-indexing
                            logger.info(
                                f"Skipping document '{document_id}': content unchanged "
                                f"(hash: {new_content_hash[:16]}...)"
                            )
                            return {
                                "success": True,
                                "document_id": document_id,
                                "chunks_created": 0,
                                "processing_time_ms": (time.time() - start_time) * 1000,
                                "cleaned_datasets": cleaned_datasets,
                                "skipped": True,
                                "skip_reason": "content_unchanged",
                            }
                        # Content changed or no existing hash: delete old SQL record first
                        # Graph/vector data will be overwritten by cognify
                        success = await self._delete_sql_data_entry(
                            entry["data_id"],
                            entry["dataset_id"],
                        )
                        if success:
                            logger.info(
                                f"Deleted old version of document '{document_id}' for re-indexing "
                                f"(old hash: {existing_hash[:16] if existing_hash else 'none'}..., "
                                f"new hash: {new_content_hash[:16] if new_content_hash else 'none'}...)"
                            )

            # Use node_set to tag the document with our document_id for later deletion
            # This allows us to find and delete documents by their external ID
            node_set = [document_id] if document_id else None

            logger.info(
                f"Starting document ingestion for {document_id or 'unknown'} "
                f"(timeout: {timeout_seconds}s, dataset: {effective_dataset_name})"
            )

            # Pre-process PDFs and images with Vision API
            # This extracts text using OpenAI Vision instead of Tesseract OCR
            file_to_ingest = content
            if Path(content).exists() and is_vision_supported(content):
                logger.info(f"Pre-processing with Vision API: {content}")

                # Calculate Vision pre-processing timeout
                vision_timeout = settings.vision_preprocessing_timeout
                if vision_timeout <= 0:
                    vision_timeout = min(timeout_seconds * 0.3, 1800)  # 30% of total, max 30 min

                vision_start_time = time.time()
                try:
                    extracted_text, was_processed = await asyncio.wait_for(
                        extract_text_from_document(content),
                        timeout=vision_timeout,
                    )
                except TimeoutError:
                    vision_elapsed = time.time() - vision_start_time
                    raise TimeoutError(
                        f"Vision pre-processing timed out after {vision_elapsed:.1f}s "
                        f"(limit: {settings.vision_request_timeout}s per request) "
                        f"for document {document_id or 'unknown'}"
                    )

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

            # Add document to each target dataset
            # For multi-team uploads, the document is added to each team's dataset
            total_chunks_created = 0
            result = None
            added_datasets: list[str] = []

            for current_dataset in target_datasets:
                logger.info(
                    f"Adding document to dataset '{current_dataset}' "
                    f"({target_datasets.index(current_dataset) + 1}/{len(target_datasets)})"
                )

                # Get user context for multi-tenant isolation.
                # Dataset type determines user context:
                # - tale_team_* datasets use team service user (shared access)
                # - tale_user_* datasets use individual user (private access)
                cognee_user = None
                team_id = extract_team_id_from_dataset(current_dataset)
                if team_id:
                    # Team dataset: use team service user for shared access
                    cognee_user = await get_or_create_team_context(team_id)
                    logger.info(f"Using team service user for team_id={team_id}")
                elif user_id:
                    # User dataset: use individual user for private access
                    cognee_user = await get_or_create_user_for_context(user_id)
                    if cognee_user:
                        logger.info(f"Using user context for user_id={user_id}")
                    else:
                        logger.warning(f"Failed to create/get user for user_id={user_id}, proceeding without isolation")

                # Wrap cognee.add() with timeout
                try:
                    add_kwargs: dict[str, Any] = {
                        "dataset_name": current_dataset,
                        "node_set": node_set,
                    }
                    if cognee_user:
                        add_kwargs["user"] = cognee_user

                    result = await asyncio.wait_for(
                        cognee.add(file_to_ingest, **add_kwargs),
                        timeout=timeout_seconds,
                    )
                except TimeoutError:
                    elapsed = time.time() - start_time
                    error_msg = (
                        f"cognee.add() timed out after {elapsed:.1f}s "
                        f"(limit: {timeout_seconds}s) for document {document_id or 'unknown'} "
                        f"in dataset {current_dataset}"
                    )
                    logger.error(error_msg)
                    raise TimeoutError(error_msg)

                logger.info(f"cognee.add() completed for {document_id or 'unknown'} in dataset {current_dataset}")

                # Process the document with incremental loading to only process new/updated data.
                # This avoids reprocessing the entire dataset on each call.
                # Wrap cognee.cognify() with timeout (remaining time from original timeout)
                elapsed_so_far = time.time() - start_time
                remaining_timeout = max(60, timeout_seconds - elapsed_so_far)  # At least 60s for cognify

                logger.info(
                    f"Starting cognee.cognify() for {document_id or 'unknown'} in dataset {current_dataset} "
                    f"(remaining timeout: {remaining_timeout:.0f}s)"
                )

                # Retry cognee.cognify() on transient errors (network issues, API errors, etc.)
                # Cognee's incremental_loading=True ensures already-processed items are skipped,
                # so retrying is safe and efficient - only failed items will be reprocessed.
                async for attempt in AsyncRetrying(
                    stop=stop_after_attempt(3),
                    wait=wait_exponential(multiplier=1, min=2, max=30),
                    before_sleep=before_sleep_log(_std_logger, logging.WARNING),
                    reraise=True,
                ):
                    with attempt:
                        try:
                            # Build cognify kwargs
                            cognify_kwargs: dict[str, Any] = {
                                "datasets": [current_dataset],
                                "incremental_loading": True,
                                # Explicitly set chunk_size to override cognee's default (8191)
                                # Smaller chunks improve retrieval precision for RAG
                                "chunk_size": settings.chunk_size,
                            }

                            # Add custom prompt for English identifier enforcement
                            # This helps FalkorDB compatibility (Cypher parser requires ASCII)
                            custom_prompt = settings.graph_extraction_prompt or DEFAULT_GRAPH_EXTRACTION_PROMPT
                            cognify_kwargs["custom_prompt"] = custom_prompt

                            # Pass user context for multi-tenant isolation
                            if cognee_user:
                                cognify_kwargs["user"] = cognee_user

                            logger.info(f"Calling cognee.cognify with chunk_size={cognify_kwargs.get('chunk_size')}, user={cognee_user.id if cognee_user else None}")
                            await asyncio.wait_for(
                                cognee.cognify(**cognify_kwargs),
                                timeout=remaining_timeout,
                            )
                            cognify_elapsed = time.time() - start_time
                            logger.info(
                                f"cognee.cognify() returned for {document_id or 'unknown'} "
                                f"in dataset {current_dataset} after {cognify_elapsed:.2f}s"
                            )
                        except TimeoutError:
                            elapsed = time.time() - start_time
                            error_msg = (
                                f"cognee.cognify() timed out after {elapsed:.1f}s "
                                f"(limit: {timeout_seconds}s) for document {document_id or 'unknown'} "
                                f"in dataset {current_dataset}"
                            )
                            logger.error(error_msg)
                            raise TimeoutError(error_msg)

                # Track chunks created for this dataset
                _, dataset_chunks = normalize_add_result(result, document_id)
                total_chunks_created += dataset_chunks
                added_datasets.append(current_dataset)

            # End of loop over target_datasets
            processing_time = (time.time() - start_time) * 1000
            logger.info(
                f"Document added to {len(added_datasets)} dataset(s) in {processing_time:.2f}ms: "
                f"{added_datasets}"
            )

            doc_id, _ = normalize_add_result(result, document_id)

            # Save original content hash for future deduplication
            if document_id and new_content_hash:
                try:
                    await self._save_original_content_hash(document_id, new_content_hash)
                except Exception as hash_err:
                    logger.warning(f"Failed to save original_content_hash: {hash_err}")

            return {
                "success": True,
                "document_id": doc_id,
                "chunks_created": total_chunks_created,
                "processing_time_ms": processing_time,
                "cleaned_datasets": cleaned_datasets,
            }

        except TimeoutError:
            # Re-raise timeout errors without wrapping
            raise
        except UnicodeDecodeError as e:
            error_msg = (
                f"Failed to decode file '{content}': {e}. "
                "The file appears to be binary or uses an unsupported encoding. "
                "Supported file types: PDF, images (PNG, JPG, etc.), DOCX, PPTX, XLSX, TXT, MD, CSV."
            )
            logger.error(error_msg)
            raise ValueError(error_msg) from e
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
        top_k: int | None = None,
        similarity_threshold: float | None = None,
        _filters: dict[str, Any] | None = None,
        user_id: str | None = None,
        team_ids: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """Search the knowledge base.

        Args:
            query: Search query
            search_type: Type of search to perform (CHUNKS, GRAPH_COMPLETION, etc.)
                         Defaults to CHUNKS for raw text chunk retrieval.
            top_k: Number of results to return
            similarity_threshold: Minimum similarity score
            _filters: Optional metadata filters (reserved for future use)
            user_id: Optional user ID for user-level isolation. If provided, search
                     is scoped to this user's context. Takes priority over team-level isolation.
            team_ids: List of team IDs to search within (required). Each team_id is converted
                      to dataset name format: tale_team_{team_id}. When user_id is not provided,
                      team service users are used for team-level isolation.

        Returns:
            List of search results
        """
        if not self.initialized:
            await self.initialize()

        try:
            start_time = time.time()

            # Build datasets to search
            # Search: include BOTH team datasets AND user's private dataset
            datasets: list[str] = []
            if team_ids and len(team_ids) > 0:
                from .utils import sanitize_team_id
                for tid in team_ids:
                    sanitized_tid = sanitize_team_id(tid)
                    if sanitized_tid:
                        datasets.append(f"tale_team_{sanitized_tid}")

            if user_id:
                # Also include user's private dataset
                from .tenant_manager import string_to_uuid
                user_dataset = f"tale_user_{str(string_to_uuid(user_id))[:16]}"
                datasets.append(user_dataset)
                logger.info(f"Including user private dataset '{user_dataset}' in search")

            if not datasets:
                logger.warning("No valid team_ids or user_id provided for search, returning empty results")
                return []

            # Map API search type to Cognee search type
            cognee_search_type = _map_api_search_type_to_cognee(search_type)

            logger.info(
                f"Searching with type={cognee_search_type.value}, query='{query[:50]}...', "
                f"team_ids={team_ids}, datasets={datasets}"
            )

            # Build base search kwargs
            effective_top_k = top_k or settings.top_k

            # Use custom system prompt for GRAPH_COMPLETION to generate detailed answers
            system_prompt = None
            if cognee_search_type in (
                SearchType.GRAPH_COMPLETION,
                SearchType.RAG_COMPLETION,
                SearchType.GRAPH_SUMMARY_COMPLETION,
            ):
                system_prompt = DEFAULT_GRAPH_COMPLETION_PROMPT

            # Search datasets concurrently, handling partial failures gracefully.
            # If one dataset has no vector index, we still want results from others.
            raw_results: list[Any] = []

            if datasets:
                async def search_dataset(ds: str) -> tuple[str, list[Any] | Exception]:
                    try:
                        # Determine user context based on dataset type
                        # - tale_team_* datasets use team service user (shared access)
                        # - tale_user_* datasets use individual user (private access)
                        search_user = None
                        team_id = extract_team_id_from_dataset(ds)
                        if team_id:
                            # Team dataset: use team service user for shared access
                            search_user = await get_or_create_team_context(team_id)
                            logger.debug(f"Searching team dataset '{ds}' with team service user")
                        elif user_id:
                            # User dataset: use individual user for private access
                            search_user = await get_or_create_user_for_context(user_id)
                            logger.debug(f"Searching user dataset '{ds}' with user context")

                        search_kwargs: dict[str, Any] = {
                            "query_type": cognee_search_type,
                            "top_k": effective_top_k,
                            "datasets": [ds],
                            "system_prompt": system_prompt,
                        }
                        if search_user:
                            search_kwargs["user"] = search_user

                        results = await cognee.search(query, **search_kwargs)
                        return (ds, results or [])
                    except Exception as e:
                        return (ds, e)

                # Search all datasets concurrently
                dataset_results = await asyncio.gather(
                    *[search_dataset(ds) for ds in datasets]
                )

                # Collect results, skip failed datasets
                for dataset, result in dataset_results:
                    if isinstance(result, Exception):
                        error_str = str(result)
                        if (
                            "No vector index found" in error_str
                            or "CollectionNotFoundError" in error_str
                            or "NoDataError" in error_str
                            or "No data found in the system" in error_str
                            or "DatabaseNotCreatedError" in error_str
                            or "DatasetNotFoundError" in error_str
                            or "No datasets found" in error_str
                        ):
                            logger.debug(f"Dataset '{dataset}' skipped: no data yet")
                        else:
                            logger.warning(f"Dataset '{dataset}' search failed: {result}")
                    elif result:
                        # Extract actual chunks from cognee's nested structure
                        # cognee.search returns: [{'search_result': [...], 'dataset_id': ...}]
                        # search_result can be [[chunk1, chunk2]] (nested) or [chunk1, chunk2] (flat)
                        chunks_extracted = 0
                        for item in result:
                            if isinstance(item, dict) and "search_result" in item:
                                search_results = item.get("search_result", [])
                                if search_results:
                                    # Handle both nested [[chunk]] and flat [chunk] structures
                                    if isinstance(search_results[0], list):
                                        # Nested: [[chunk1, chunk2, ...]]
                                        raw_results.extend(search_results[0])
                                        chunks_extracted += len(search_results[0])
                                    else:
                                        # Flat: [chunk1, chunk2, ...]
                                        raw_results.extend(search_results)
                                        chunks_extracted += len(search_results)
                            else:
                                raw_results.append(item)
                                chunks_extracted += 1
                        logger.debug(f"Dataset '{dataset}' returned {chunks_extracted} chunks")
            else:
                # No datasets specified - search globally
                global_search_kwargs: dict[str, Any] = {
                    "query_type": cognee_search_type,
                    "top_k": effective_top_k,
                    "system_prompt": system_prompt,
                }
                if explicit_user:
                    global_search_kwargs["user"] = explicit_user

                global_results = await cognee.search(query, **global_search_kwargs)
                # Extract actual chunks from cognee's nested structure
                for item in global_results or []:
                    if isinstance(item, dict) and "search_result" in item:
                        search_results = item.get("search_result", [])
                        if search_results:
                            # Handle both nested [[chunk]] and flat [chunk] structures
                            if isinstance(search_results[0], list):
                                raw_results.extend(search_results[0])
                            else:
                                raw_results.extend(search_results)
                    else:
                        raw_results.append(item)

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

            # Handle DatasetNotFoundError - happens when the specified dataset(s) don't exist
            # This is normal when searching before any documents are indexed or
            # when searching datasets that haven't been created yet
            if "DatasetNotFoundError" in error_str or "No datasets found" in error_str:
                logger.info(
                    f"Dataset(s) not found for search: {datasets}. "
                    "This is normal if no documents have been indexed to these datasets yet. "
                    "Search returning empty results."
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
        top_k: int | None = None,
        system_prompt: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        user_id: str | None = None,
        team_ids: list[str] | None = None,
    ) -> dict[str, Any]:
        """Generate a response using RAG.

        Args:
            query: User query
            top_k: Number of context documents
            system_prompt: Optional system prompt
            temperature: LLM temperature
            max_tokens: Maximum tokens to generate
            user_id: Optional user ID for user-level isolation. Takes priority over team-level.
            team_ids: List of team IDs to retrieve context from (required).

        Returns:
            Dictionary with generated response and sources
        """
        if not self.initialized:
            await self.initialize()

        try:
            start_time = time.time()

            # Search for relevant context with multi-tenant team filtering
            search_results = await self.search(
                query, top_k=top_k, user_id=user_id, team_ids=team_ids
            )

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

            # Use cached LLM configuration and reusable OpenAI client
            # This avoids per-request overhead from config parsing and connection setup
            llm_config = self._llm_config
            if llm_config is None or self._openai_client is None:
                raise RuntimeError("CogneeService not initialized. Call initialize() first.")

            # Build completion kwargs
            # model is guaranteed to be set by get_llm_config() validation
            completion_kwargs: dict[str, Any] = {
                "model": llm_config["model"],
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

            # Generate response using reusable OpenAI client (connection pooling)
            completion = await self._openai_client.chat.completions.create(**completion_kwargs)
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
                    "response": (
                        "No documents have been indexed yet. "
                        "Please add documents first using the /api/v1/documents endpoint."
                    ),
                    "sources": [],
                    "processing_time_ms": 0,
                }
            logger.error(f"Generation failed: {e}")
            raise



    async def delete_document(
        self,
        document_id: str,
        mode: str = "hard",
        team_ids: list[str] | None = None,
    ) -> dict[str, Any]:
        """Delete a document from the knowledge base by document ID.

        Why we don't use cognee.delete API directly:
        --------------------------------------------
        cognee's delete API (cognee.api.v1.delete.delete) has a bug when used with
        the FalkorDB community adapter (cognee-community-hybrid-adapter-falkor).

        The bug is in the following call chain:
        1. cognee.delete(data_id, dataset_id, mode, user) receives Data.id (UUID)
        2. It calls delete_single_document(str(data_point.id), ...) passing UUID as string
        3. delete_single_document calls graph_db.get_document_subgraph(data_id)
        4. FalkorDB adapter's get_document_subgraph(content_hash) expects content_hash
           and searches for: d.id CONTAINS 'text_{content_hash}'

        The mismatch: cognee passes UUID (e.g., "04b89322-9d1c-5054-aeab-438a0b035504")
        but FalkorDB adapter expects content_hash (e.g., "eb029b1a...") to search for
        nodes with names like "text_eb029b1a...".

        Result: get_document_subgraph returns empty -> DocumentSubgraphNotFoundError (404)

        Our workaround:
        ---------------
        We call the FalkorDB adapter directly with the correct content_hash from the
        Data record, bypassing cognee's buggy delete flow while still using cognee's
        underlying infrastructure (Data model, FalkorDB adapter, vector engine).

        This approach:
        - Uses cognee's Data model to find records by document_id (node_set)
        - Uses cognee's FalkorDB adapter methods (get_document_subgraph, delete_node)
        - Uses cognee's vector engine for vector cleanup
        - Maintains compatibility with cognee's data structures

        When cognee fixes this bug (passing content_hash instead of data_id to
        delete_single_document), we can switch back to using cognee.delete directly.

        Args:
            document_id: ID of the document to delete (must match the ID used when adding)
            mode: "soft" or "hard" - "hard" (default) deletes degree-one entity nodes too
            team_ids: Team IDs for authorization (only deletes from matching teams)

        Returns:
            Dictionary with operation results
        """
        if not self.initialized:
            await self.initialize()

        try:
            start_time = time.time()
            logger.info(f"Looking for documents with node_set containing: {document_id}")

            # Step 1: Find Data records by document_id (stored in node_set)
            db_engine = get_relational_engine()
            async with db_engine.get_async_session() as session:
                result = await session.execute(
                    select(Data).where(
                        cast(Data.node_set, String).contains(document_id)
                    )
                )
                matching_data = result.scalars().all()

                if not matching_data:
                    processing_time = (time.time() - start_time) * 1000
                    logger.info(f"No documents found with node_set containing '{document_id}'")
                    return {
                        "success": True,
                        "message": f"No documents found with ID '{document_id}'",
                        "deleted_count": 0,
                        "deleted_data_ids": [],
                        "processing_time_ms": processing_time,
                    }

                logger.info(f"Found {len(matching_data)} document(s) to delete")

                # Step 2: For each Data record, delete graph, vector, and SQL data
                deleted_data_ids: list[str] = []
                deleted_graph_nodes: list[str] = []

                for data in matching_data:
                    # Get dataset link to check team authorization
                    dataset_link = (
                        await session.execute(
                            select(DatasetData).where(DatasetData.data_id == data.id)
                        )
                    ).scalars().first()

                    if not dataset_link:
                        logger.warning(f"No dataset link for {data.id}, skipping")
                        continue

                    dataset_id = dataset_link.dataset_id

                    # Get dataset record to check team authorization
                    dataset_record = (
                        await session.execute(
                            select(Dataset).where(Dataset.id == dataset_id)
                        )
                    ).scalars().first()

                    if dataset_record and dataset_record.name:
                        team_id = extract_team_id_from_dataset(dataset_record.name)
                        if team_id and team_ids and team_id not in team_ids:
                            logger.warning(f"Skipping {data.id}: team '{team_id}' not authorized")
                            continue

                    # Step 3: Delete from graph using direct FalkorDB queries
                    #
                    # Why we can't use FalkorDBAdapter.get_document_subgraph():
                    # 1. The adapter has a bug - it searches d.id CONTAINS 'text_{hash}'
                    #    but TextDocument.id is a UUID, not a string with 'text_' prefix
                    #    (the 'text_' prefix is in TextDocument.name, not id)
                    # 2. Documents are stored in per-tenant graphs with UUID names,
                    #    not in the default 'tale_default' graph
                    #
                    # Our solution: Use direct FalkorDB queries to:
                    # 1. Search all graphs for TextDocument where id = Data.id
                    # 2. Find all related nodes via relationships
                    # 3. Delete all found nodes
                    #
                    # Note: TextDocument.id equals Data.id (confirmed by inspection)
                    data_id_str = str(data.id)
                    try:
                        from falkordb.falkordb import FalkorDB as FalkorDBClient

                        falkordb_url = os.environ.get("GRAPH_DATABASE_URL", "graph-db")
                        falkordb_port = int(os.environ.get("GRAPH_DATABASE_PORT", "6379"))

                        # Connect to FalkorDB
                        db = FalkorDBClient(host=falkordb_url, port=falkordb_port)
                        graphs = db.list_graphs()

                        # Search each graph for the document
                        for graph_name in graphs:
                            try:
                                graph = db.select_graph(graph_name)

                                # Find TextDocument with matching id
                                result = graph.query(
                                    "MATCH (d:TextDocument) WHERE d.id = $data_id RETURN d.id",
                                    {"data_id": data_id_str}
                                )

                                if not result.result_set:
                                    continue

                                logger.info(f"Found document {data_id_str} in graph {graph_name}")

                                # Step 3a: Get DocumentChunk IDs for vector deletion
                                # We need to collect chunk IDs before deleting graph nodes
                                # because we need them to delete from vector collections
                                result = graph.query(
                                    "MATCH (d:TextDocument {id: $data_id})<-[:IS_PART_OF]-(c:DocumentChunk) "
                                    "RETURN c.id",
                                    {"data_id": data_id_str}
                                )
                                chunk_ids = [row[0] for row in result.result_set] if result.result_set else []
                                logger.debug(f"Found {len(chunk_ids)} DocumentChunks to delete")

                                # Step 3b: Delete from vector collections
                                # Note: FalkorDB's hybrid adapter stores vectors as node properties
                                # (e.g., DocumentChunk.text_vector), so vectors are automatically
                                # deleted when we delete the graph nodes. No separate vector deletion
                                # is needed. This is different from other vector DBs like PGVector or
                                # LanceDB which store vectors in separate collections.

                                # Step 3c: Delete related DocumentChunks from graph
                                result = graph.query(
                                    "MATCH (d:TextDocument {id: $data_id})<-[:IS_PART_OF]-(c:DocumentChunk) "
                                    "DETACH DELETE c RETURN count(c)",
                                    {"data_id": data_id_str}
                                )
                                chunks_deleted = result.result_set[0][0] if result.result_set else 0
                                logger.debug(f"Deleted {chunks_deleted} DocumentChunks from graph")

                                # Delete the TextDocument
                                graph.query(
                                    "MATCH (d:TextDocument {id: $data_id}) DETACH DELETE d",
                                    {"data_id": data_id_str}
                                )
                                deleted_graph_nodes.append(data_id_str)
                                logger.debug(f"Deleted TextDocument {data_id_str}")

                                # Delete NodeSet (our document_id marker)
                                result = graph.query(
                                    "MATCH (ns:NodeSet) WHERE ns.name = $doc_id "
                                    "DETACH DELETE ns RETURN count(ns)",
                                    {"doc_id": document_id}
                                )

                                # If hard mode, delete orphaned entities (degree-one nodes)
                                # FalkorDB doesn't support size((e)--()) syntax, use OPTIONAL MATCH instead
                                if mode == "hard":
                                    result = graph.query(
                                        "MATCH (e:Entity) "
                                        "OPTIONAL MATCH (e)-[r]-() "
                                        "WITH e, count(r) as degree "
                                        "WHERE degree <= 1 "
                                        "DETACH DELETE e "
                                        "RETURN count(e)"
                                    )
                                    entities_deleted = result.result_set[0][0] if result.result_set else 0
                                    if entities_deleted:
                                        logger.debug(f"Deleted {entities_deleted} orphaned entities")

                                    result = graph.query(
                                        "MATCH (et:EntityType) "
                                        "OPTIONAL MATCH (et)-[r]-() "
                                        "WITH et, count(r) as degree "
                                        "WHERE degree = 0 "
                                        "DETACH DELETE et "
                                        "RETURN count(et)"
                                    )

                                logger.info(f"Deleted document subgraph from graph {graph_name}")
                                break  # Found and deleted, no need to check other graphs

                            except Exception as graph_query_err:
                                logger.debug(f"Error querying graph {graph_name}: {graph_query_err}")
                                continue

                    except Exception as graph_err:
                        logger.warning(f"Graph deletion failed for {data.id}: {graph_err}")
                        # Continue to delete SQL records even if graph deletion fails

                    # Step 5: Delete SQL records (DatasetData, Data)
                    await session.execute(
                        sql_delete(DatasetData).where(
                            DatasetData.data_id == data.id,
                            DatasetData.dataset_id == dataset_id,
                        )
                    )

                    # Check if data is in other datasets before deleting
                    remaining = (
                        await session.execute(
                            select(DatasetData).where(DatasetData.data_id == data.id)
                        )
                    ).scalars().first()

                    if not remaining:
                        await session.execute(
                            sql_delete(Data).where(Data.id == data.id)
                        )

                    deleted_data_ids.append(str(data.id))
                    logger.info(f"Deleted document: {data.id} (content_hash={data.content_hash})")

                await session.commit()

            processing_time = (time.time() - start_time) * 1000
            logger.info(
                f"Deleted {len(deleted_data_ids)} document(s), "
                f"{len(deleted_graph_nodes)} graph nodes in {processing_time:.2f}ms"
            )

            return {
                "success": True,
                "message": f"Deleted {len(deleted_data_ids)} document(s) with ID '{document_id}'",
                "deleted_count": len(deleted_data_ids),
                "deleted_data_ids": deleted_data_ids,
                "deleted_graph_nodes": len(deleted_graph_nodes),
                "processing_time_ms": processing_time,
            }

        except Exception as e:
            error_str = str(e)
            if "UndefinedTableError" in error_str or "relation \"data\" does not exist" in error_str:
                logger.info(
                    f"Data table does not exist yet, no documents to delete for '{document_id}'"
                )
                return {
                    "success": True,
                    "message": f"No documents found with ID '{document_id}' (database not initialized)",
                    "deleted_count": 0,
                    "deleted_data_ids": [],
                    "processing_time_ms": None,
                }
            logger.error(f"Failed to delete document: {e}")
            raise

    async def reset(self) -> None:
        """Reset the knowledge base (delete all data).

        This clears all documents, embeddings, knowledge graph data, and system metadata.
        After reset, the service will re-initialize on next use.

        The RAG service uses a dedicated database (tale_rag) which is completely
        dropped and recreated to ensure a clean slate. This is safe because:
        - tale_rag is isolated from other services (Convex uses tale_platform)
        - The database name is hardcoded to prevent accidental deletion of wrong database
        """
        try:
            logger.info("Starting knowledge base reset...")

            # Step 1: Drop and recreate the dedicated RAG database
            # This is the most reliable way to ensure a clean slate
            await self._reset_rag_database()

            # Step 2: Direct cleanup of graph database
            await self._cleanup_graph_database()

            # Reset initialized state so service re-initializes on next use
            self.initialized = False

            logger.info("Knowledge base reset successfully")

        except Exception as e:
            logger.error(f"Failed to reset knowledge base: {e}")
            raise

    async def _reset_rag_database(self) -> None:
        """Drop and recreate the dedicated RAG database (tale_rag).

        This is the most reliable way to reset the knowledge base because it:
        - Removes ALL tables, indexes, and data in one operation
        - Avoids schema migration issues when Cognee updates its schema
        - Is completely safe because tale_rag is isolated from other services

        Safety: The database name 'tale_rag' is HARDCODED to prevent accidental
        deletion of other databases. This method will refuse to operate on any
        other database name.
        """
        # HARDCODED database name for safety - never delete other databases
        RAG_DATABASE_NAME = "tale_rag"

        try:
            from urllib.parse import urlparse

            import asyncpg

            from ...config import settings

            # Parse the database URL to get connection parameters
            db_url = settings.get_database_url()
            parsed = urlparse(db_url)

            # Extract the database name from the URL
            db_name_from_url = parsed.path.lstrip("/").split("?")[0]

            # Safety check: only proceed if the configured database is tale_rag
            if db_name_from_url != RAG_DATABASE_NAME:
                logger.error(
                    f"Safety check failed: configured database is '{db_name_from_url}', "
                    f"but only '{RAG_DATABASE_NAME}' can be reset. "
                    "This prevents accidental deletion of other databases."
                )
                raise ValueError(
                    f"Cannot reset database '{db_name_from_url}'. "
                    f"Only '{RAG_DATABASE_NAME}' is allowed for safety."
                )

            # Connect to the 'postgres' database to drop/create tale_rag
            # (Cannot drop a database while connected to it)
            admin_conn = await asyncpg.connect(
                user=parsed.username,
                password=parsed.password,
                host=parsed.hostname,
                port=parsed.port or 5432,
                database="postgres",
            )

            try:
                # Terminate all connections to the RAG database
                await admin_conn.execute(
                    f"""
                    SELECT pg_terminate_backend(pid)
                    FROM pg_stat_activity
                    WHERE datname = '{RAG_DATABASE_NAME}'
                    AND pid <> pg_backend_pid()
                    """
                )
                logger.debug(f"Terminated existing connections to {RAG_DATABASE_NAME}")

                # Drop the database if it exists
                await admin_conn.execute(f"DROP DATABASE IF EXISTS {RAG_DATABASE_NAME}")
                logger.info(f"Dropped database: {RAG_DATABASE_NAME}")

                # Recreate the database
                await admin_conn.execute(f"CREATE DATABASE {RAG_DATABASE_NAME}")
                logger.info(f"Created database: {RAG_DATABASE_NAME}")

            finally:
                await admin_conn.close()

            # Connect to the new database and enable required extensions
            rag_conn = await asyncpg.connect(
                user=parsed.username,
                password=parsed.password,
                host=parsed.hostname,
                port=parsed.port or 5432,
                database=RAG_DATABASE_NAME,
            )

            try:
                await rag_conn.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')
                await rag_conn.execute('CREATE EXTENSION IF NOT EXISTS "vector"')
                logger.info(f"Enabled extensions in {RAG_DATABASE_NAME}")
            finally:
                await rag_conn.close()

            logger.info(f"RAG database reset complete: {RAG_DATABASE_NAME}")

        except Exception as e:
            logger.error(f"Failed to reset RAG database: {e}")
            raise

    async def _cleanup_pgvector_tables(self) -> None:
        """Directly drop all Cognee-related tables from PostgreSQL (legacy fallback).

        This is a fallback cleanup that ensures vector data is removed
        even if cognee's prune functions don't work correctly.

        Cognee may create tables in different schemas depending on configuration.
        We query both 'public' and the database name as schema (e.g., 'tale')
        to ensure all Cognee tables are cleaned up.

        Safety: Only drops tables that match known Cognee table patterns to avoid
        accidentally deleting unrelated data.
        """
        # Known Cognee table name patterns (case-insensitive matching)
        # These are tables created by Cognee for knowledge graph and vector storage
        COGNEE_TABLE_PATTERNS = {
            # Core Cognee tables
            "data",
            "datasets",
            "dataset_data",
            "dataset_database",
            "acls",
            "events",
            "metrics",
            "graph_metrics",
            "graph_relationship_ledger",
            "notebooks",
            "permissions",
            "pipeline_runs",
            "principals",
            "queries",
            "results",
            "roles",
            "role_default_permissions",
            "tenants",
            "tenant_default_permissions",
            "users",
            "user_default_permissions",
            "user_roles",
            "user_tenants",
            # Knowledge graph entity tables (pattern: EntityType_fieldname)
            # These are dynamically created based on the knowledge graph schema
        }

        # Patterns for dynamically named tables (e.g., DocumentChunk_text, Entity_name)
        COGNEE_TABLE_PREFIXES = (
            "documentchunk_",
            "edgetype_",
            "entitytype_",
            "entity_",
            "textdocument_",
            "textsummary_",
        )

        def is_cognee_table(table_name: str) -> bool:
            """Check if a table name matches known Cognee patterns."""
            lower_name = table_name.lower()
            # Check exact matches
            if lower_name in COGNEE_TABLE_PATTERNS:
                return True
            # Check prefix patterns (for dynamically named tables)
            if any(lower_name.startswith(prefix) for prefix in COGNEE_TABLE_PREFIXES):
                return True
            return False

        try:
            from cognee.infrastructure.databases.relational import get_relational_engine
            from sqlalchemy import text

            from ...config import settings

            db_engine = get_relational_engine()

            # Get the database name which Cognee may use as schema name
            db_name = settings.get_database_url().split("/")[-1].split("?")[0]

            # Schemas to clean up: 'public' and the database name (if different)
            schemas_to_clean = ["public"]
            if db_name and db_name != "public":
                schemas_to_clean.append(db_name)

            async with db_engine.get_async_session() as session:
                total_dropped = 0
                skipped_tables = []

                for schema_name in schemas_to_clean:
                    # Get list of all tables in this schema
                    result = await session.execute(
                        text(
                            "SELECT tablename FROM pg_tables WHERE schemaname = :schema"
                        ),
                        {"schema": schema_name},
                    )
                    tables = [row[0] for row in result.fetchall()]

                    if not tables:
                        logger.debug(f"No tables found in schema '{schema_name}'")
                        continue

                    # Drop only Cognee-related tables
                    for table_name in tables:
                        if not is_cognee_table(table_name):
                            skipped_tables.append(f"{schema_name}.{table_name}")
                            continue

                        try:
                            await session.execute(
                                text(
                                    f'DROP TABLE IF EXISTS "{schema_name}"."{table_name}" CASCADE'
                                )
                            )
                            total_dropped += 1
                            logger.debug(f"Dropped table: {schema_name}.{table_name}")
                        except Exception as e:
                            logger.warning(
                                f"Failed to drop table {schema_name}.{table_name}: {e}"
                            )

                await session.commit()

                if skipped_tables:
                    logger.debug(
                        f"Skipped {len(skipped_tables)} non-Cognee tables: {skipped_tables[:5]}..."
                    )

                logger.info(
                    f"Dropped {total_dropped} Cognee tables from schemas: {schemas_to_clean}"
                )

        except Exception as e:
            logger.warning(f"PGVector cleanup failed (continuing): {e}")

    async def _cleanup_graph_database(self) -> None:
        """Clear all graph data from FalkorDB.

        Connects to FalkorDB and deletes all graphs to ensure complete reset.
        Uses GRAPH.LIST to enumerate graphs and GRAPH.DELETE to remove each one.
        """
        import redis

        falkordb_url = os.environ.get("GRAPH_DATABASE_URL", "graph-db")
        falkordb_port = int(os.environ.get("GRAPH_DATABASE_PORT", "6379"))

        try:
            client = redis.Redis(host=falkordb_url, port=falkordb_port, decode_responses=True)

            graphs = client.execute_command("GRAPH.LIST")

            if not graphs:
                logger.info("FalkorDB: No graphs to delete")
                return

            deleted_count = 0
            for graph_name in graphs:
                try:
                    client.execute_command("GRAPH.DELETE", graph_name)
                    deleted_count += 1
                    logger.debug(f"Deleted FalkorDB graph: {graph_name}")
                except Exception as e:
                    logger.warning(f"Failed to delete graph {graph_name}: {e}")

            logger.info(f"FalkorDB cleanup complete: deleted {deleted_count}/{len(graphs)} graphs")

        except redis.ConnectionError as e:
            logger.warning(f"Could not connect to FalkorDB at {falkordb_url}:{falkordb_port}: {e}")
        except Exception as e:
            logger.warning(f"FalkorDB cleanup failed (continuing): {e}")


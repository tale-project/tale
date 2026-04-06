"""Main RAG service.

Provides: add_document, search, generate, delete_document.
All operations use the private_knowledge schema in tale_knowledge database.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import time
from typing import Any

import asyncpg
from loguru import logger
from openai import AsyncOpenAI
from tale_knowledge.embedding import EmbeddingService
from tale_knowledge.vision import VisionClient
from tale_shared.db import acquire_with_retry

from ..config import settings
from .database import (
    SCHEMA,
    close_pool,
    init_pool,
    pin_embedding_dimensions,
)
from .indexing_service import index_document
from .search_service import RagSearchService

RAG_TOP_K = 30
RAG_TEMPERATURE = 0.3
RAG_MAX_TOKENS = 2000
RAG_MAX_CONTEXT_CHARS = 200_000

SYSTEM_PROMPT = (
    "You are a knowledgeable assistant that provides accurate answers based on the provided context. "
    "Instructions:\n"
    "1. Answer the question using ONLY the information from the context\n"
    "2. If the context contains specific details (numbers, dates, names), include them\n"
    "3. If the context doesn't contain relevant information, clearly state that\n"
    "4. Respond in the same language as the user's question\n"
    "5. Be concise but thorough"
)


_CONFIG_CHECK_INTERVAL = 15  # seconds


_background_tasks: set[asyncio.Task[None]] = set()


async def _safe_close(coro) -> None:
    """Close an old client after a grace period for in-flight requests."""
    await asyncio.sleep(30)
    try:
        await coro
    except Exception:
        logger.warning("Failed to close old client", exc_info=True)


class RagService:
    def __init__(self) -> None:
        self.initialized = False
        self._init_lock = asyncio.Lock()
        self._pool: asyncpg.Pool | None = None
        self._embedding_service: EmbeddingService | None = None
        self._vision_client: VisionClient | None = None
        self._openai_client: AsyncOpenAI | None = None
        self._search_service: RagSearchService | None = None
        self._llm_config: dict | None = None
        self._vision_config: tuple | None = None
        self._last_config_check: float = 0

    async def initialize(self) -> None:
        """Initialize database pool, embedding service, vision client, and LLM client."""
        if self.initialized:
            return

        async with self._init_lock:
            if self.initialized:
                return

            await self._do_initialize()

    async def _do_initialize(self) -> None:

        # Database pool
        self._pool = await init_pool()

        # Embedding service
        llm_config = settings.get_llm_config()
        embedding_model = llm_config["embedding_model"]
        dimensions = settings.get_embedding_dimensions()

        self._embedding_service = EmbeddingService(
            api_key=llm_config["api_key"],
            base_url=llm_config["base_url"],
            model=embedding_model,
            dimensions=dimensions,
        )
        self._llm_config = llm_config

        # Pin embedding dimensions and create HNSW index (runtime config, not a migration)
        await pin_embedding_dimensions(self._pool, dimensions)

        # Vision client (optional — only if model is configured)
        try:
            vision_config = settings.get_vision_config()
            v_base_url, v_api_key, v_model = vision_config
            self._vision_client = VisionClient(
                api_key=v_api_key,
                model=v_model,
                base_url=v_base_url,
                timeout=120.0,
                request_timeout=float(settings.vision_request_timeout),
                max_concurrent_pages=settings.vision_max_concurrent_pages,
                pdf_dpi=settings.vision_pdf_dpi,
                ocr_prompt=settings.vision_extraction_prompt,
            )
            self._vision_config = vision_config
            logger.info("Vision client initialized with model: {}", v_model)
        except ValueError:
            logger.info("No vision model configured, Vision features disabled")
            self._vision_client = None

        # OpenAI client for generation
        self._openai_client = AsyncOpenAI(
            api_key=llm_config["api_key"],
            base_url=llm_config["base_url"],
        )

        # Search service
        self._search_service = RagSearchService(self._pool, self._embedding_service)

        self._last_config_check = time.monotonic()
        self.initialized = True
        logger.info("RagService initialized")

    def _maybe_refresh_clients(self) -> None:
        """Check provider config freshness; rebuild clients if changed.

        This method is synchronous (no await) so that all attribute swaps
        happen atomically from asyncio's cooperative-scheduling perspective.
        """
        if not self.initialized:
            return
        now = time.monotonic()
        if (now - self._last_config_check) < _CONFIG_CHECK_INTERVAL:
            return
        self._last_config_check = now

        # Check chat/embedding config
        new_llm_config = settings.get_llm_config()
        if new_llm_config != self._llm_config:
            if not new_llm_config.get("api_key"):
                logger.warning("Skipping LLM config reload: empty API key")
            else:
                new_dims = settings.get_embedding_dimensions()
                if self._embedding_service and new_dims != self._embedding_service.dimensions:
                    logger.error(
                        "Embedding dimensions changed ({} -> {}). Restart required.",
                        self._embedding_service.dimensions,
                        new_dims,
                    )
                else:
                    # Prepare new clients before swapping any state
                    new_emb = EmbeddingService(
                        api_key=new_llm_config["api_key"],
                        base_url=new_llm_config["base_url"],
                        model=new_llm_config["embedding_model"],
                        dimensions=new_dims,
                    )
                    new_oai = AsyncOpenAI(
                        api_key=new_llm_config["api_key"],
                        base_url=new_llm_config["base_url"],
                    )

                    # Swap all at once (atomic from asyncio's cooperative perspective)
                    old_emb = self._embedding_service
                    old_oai = self._openai_client
                    self._embedding_service = new_emb
                    self._openai_client = new_oai
                    if self._pool:
                        self._search_service = RagSearchService(self._pool, new_emb)
                    self._llm_config = new_llm_config
                    logger.info("RAG LLM clients refreshed: model={}", new_llm_config.get("embedding_model"))

                    # Close old clients (fire-and-forget with grace period)
                    loop = asyncio.get_running_loop()
                    if old_emb:
                        task = loop.create_task(_safe_close(old_emb.close()))
                        _background_tasks.add(task)
                        task.add_done_callback(_background_tasks.discard)
                    if old_oai:
                        task = loop.create_task(_safe_close(old_oai.close()))
                        _background_tasks.add(task)
                        task.add_done_callback(_background_tasks.discard)

        # Check vision config
        try:
            new_vision_config = settings.get_vision_config()
            v_base_url, v_api_key, v_model = new_vision_config
            if new_vision_config != self._vision_config and v_api_key:
                old_vision = self._vision_client
                self._vision_client = VisionClient(
                    api_key=v_api_key,
                    model=v_model,
                    base_url=v_base_url,
                    timeout=120.0,
                    request_timeout=float(settings.vision_request_timeout),
                    max_concurrent_pages=settings.vision_max_concurrent_pages,
                    pdf_dpi=settings.vision_pdf_dpi,
                    ocr_prompt=settings.vision_extraction_prompt,
                )
                self._vision_config = new_vision_config
                logger.info("RAG vision client refreshed: model={}", v_model)
                if old_vision:
                    loop = asyncio.get_running_loop()
                    task = loop.create_task(_safe_close(old_vision.close()))
                    _background_tasks.add(task)
                    task.add_done_callback(_background_tasks.discard)
        except ValueError:
            logger.debug("No vision model in provider config, skipping vision refresh")

    async def add_document(
        self,
        content: bytes,
        file_id: str,
        filename: str,
        *,
        source_created_at: dt.datetime | None = None,
        source_modified_at: dt.datetime | None = None,
    ) -> dict[str, Any]:
        """Add a document to the knowledge base."""
        if not self.initialized:
            await self.initialize()
        self._maybe_refresh_clients()

        if self._pool is None:
            raise RuntimeError("RagService not initialized: database pool is None")
        if self._embedding_service is None:
            raise RuntimeError("RagService not initialized: embedding service is None")

        return await index_document(
            self._pool,
            file_id,
            content,
            filename,
            embedding_service=self._embedding_service,
            vision_client=self._vision_client,
            chunk_size=settings.chunk_size,
            chunk_overlap=settings.chunk_overlap,
            source_created_at=source_created_at,
            source_modified_at=source_modified_at,
        )

    async def search(
        self,
        query: str,
        *,
        top_k: int | None = None,
        similarity_threshold: float | None = None,
        file_ids: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """Search the knowledge base using hybrid BM25 + vector search."""
        if not self.initialized:
            await self.initialize()
        self._maybe_refresh_clients()

        if self._search_service is None:
            raise RuntimeError("RagService not initialized: search service is None")

        effective_top_k = top_k if top_k is not None else settings.top_k
        threshold = similarity_threshold if similarity_threshold is not None else settings.similarity_threshold

        results = await self._search_service.search(
            query,
            file_ids=file_ids,
            top_k=effective_top_k,
        )

        if threshold > 0:
            results = [r for r in results if r.get("score", 0) >= threshold]

        return results

    async def generate(
        self,
        query: str,
        file_ids: list[str] | None = None,
    ) -> dict[str, Any]:
        """Generate a response using RAG: search -> context assembly -> LLM."""
        if not self.initialized:
            await self.initialize()
        self._maybe_refresh_clients()

        if self._openai_client is None:
            raise RuntimeError("RagService not initialized: OpenAI client is None")

        try:
            start_time = time.time()

            search_results = await self.search(query, top_k=RAG_TOP_K, file_ids=file_ids)

            if not search_results:
                return {
                    "success": False,
                    "response": (
                        "No relevant information found in the knowledge base. "
                        "Please add documents first using the /api/v1/documents endpoint."
                    ),
                    "sources": [],
                    "processing_time_ms": 0,
                }

            # Build context with char limit
            context_parts: list[str] = []
            total_chars = 0
            for i, result in enumerate(search_results, 1):
                content = result.get("content", "")
                if content:
                    part = f"[{i}] {content}"
                    if total_chars + len(part) > RAG_MAX_CONTEXT_CHARS:
                        logger.warning(
                            "Context truncated at {} chars, used {}/{} chunks",
                            total_chars,
                            len(context_parts),
                            len(search_results),
                        )
                        break
                    context_parts.append(part)
                    total_chars += len(part) + 2

            context = "\n\n".join(context_parts)
            user_message = f"Context:\n{context}\n\nQuestion: {query}"

            llm_config = settings.get_llm_config()

            completion = await self._openai_client.chat.completions.create(
                model=llm_config["model"],
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_message},
                ],
                temperature=RAG_TEMPERATURE,
                max_tokens=RAG_MAX_TOKENS,
            )

            if not completion.choices:
                raise ValueError("LLM returned empty choices array")
            response = completion.choices[0].message.content or ""

            processing_time = (time.time() - start_time) * 1000
            logger.info("Generation completed in {:.2f}ms", processing_time)

            return {
                "success": True,
                "response": response,
                "sources": search_results,
                "processing_time_ms": processing_time,
            }

        except Exception as e:
            logger.error("Generation failed: {}", e)
            raise

    MAX_CHUNK_WINDOW = 200

    async def get_document_content(
        self,
        file_id: str,
        *,
        chunk_start: int = 1,
        chunk_end: int | None = None,
        return_chunks: bool = False,
    ) -> dict[str, Any] | None:
        """Retrieve document content by reassembling stored chunks.

        Args:
            file_id: Logical file identifier.
            chunk_start: First chunk to return (1-indexed).
            chunk_end: Last chunk to return (1-indexed, inclusive). None = capped by MAX_CHUNK_WINDOW.
            return_chunks: If True, include individual chunks as a list.

        Returns:
            Response dict with content and metadata, or None if not found.
        """
        if not self.initialized:
            await self.initialize()

        if self._pool is None:
            raise RuntimeError("RagService not initialized: database pool is None")

        if chunk_end is None:
            chunk_end = chunk_start + self.MAX_CHUNK_WINDOW - 1

        where = "file_id = $1"
        params: list[Any] = [file_id]

        async with acquire_with_retry(self._pool) as conn:
            doc = await conn.fetchrow(
                f"SELECT id, file_id, filename, chunks_count, source_created_at, source_modified_at"
                f" FROM {SCHEMA}.documents WHERE {where} LIMIT 1",
                *params,
            )

            if doc is None:
                return None

            doc_uuid = doc["id"]
            total_chunks = doc["chunks_count"]

            # Convert 1-indexed API params to 0-indexed chunk_index
            chunk_params: list[Any] = [doc_uuid, chunk_start - 1, chunk_end - 1]

            rows = await conn.fetch(
                f"SELECT chunk_index, chunk_content FROM {SCHEMA}.chunks "
                f"WHERE document_id = $1 AND chunk_index >= $2 AND chunk_index <= $3 "
                f"ORDER BY chunk_index ASC",
                *chunk_params,
            )

        if not rows:
            return {
                "file_id": file_id,
                "title": doc["filename"],
                "content": "",
                "chunk_range": {"start": 0, "end": 0},
                "total_chunks": total_chunks,
                "total_chars": 0,
                "source_created_at": doc["source_created_at"],
                "source_modified_at": doc["source_modified_at"],
            }

        combined = "\n\n".join(row["chunk_content"] for row in rows)

        actual_start = rows[0]["chunk_index"] + 1
        actual_end = rows[-1]["chunk_index"] + 1

        result = {
            "file_id": file_id,
            "title": doc["filename"],
            "content": combined,
            "chunk_range": {"start": actual_start, "end": actual_end},
            "total_chunks": total_chunks,
            "total_chars": len(combined),
            "source_created_at": doc["source_created_at"],
            "source_modified_at": doc["source_modified_at"],
        }

        if return_chunks:
            result["chunks"] = [{"index": row["chunk_index"] + 1, "content": row["chunk_content"]} for row in rows]

        return result

    async def get_document_statuses(
        self,
        file_ids: list[str],
    ) -> dict[str, dict[str, Any] | None]:
        """Get statuses for multiple documents by file_id.

        Returns a dict mapping file_id to status info or None if not found.
        When a document has multiple scope rows, priority is: processing > failed > completed.

        If ANY scope row is still processing, the document is considered processing.
        This ensures reindex operations are visible even when other scope rows
        remain completed.
        """
        if not self.initialized:
            await self.initialize()

        if self._pool is None:
            raise RuntimeError("RagService not initialized: database pool is None")

        async with acquire_with_retry(self._pool) as conn:
            rows = await conn.fetch(
                f"""
                SELECT DISTINCT ON (file_id)
                    file_id, status, error, source_created_at, source_modified_at
                FROM {SCHEMA}.documents
                WHERE file_id = ANY($1)
                ORDER BY file_id,
                    CASE status
                        WHEN 'processing' THEN 0
                        WHEN 'failed' THEN 1
                        WHEN 'completed' THEN 2
                        ELSE 3
                    END,
                    updated_at DESC
                """,
                file_ids,
            )

        found = {
            row["file_id"]: {
                "status": row["status"],
                "error": row["error"],
                "source_created_at": row["source_created_at"],
                "source_modified_at": row["source_modified_at"],
            }
            for row in rows
        }
        return {fid: found.get(fid) for fid in file_ids}

    async def delete_document(
        self,
        file_id: str,
    ) -> dict[str, Any]:
        """Delete a document and its chunks from the knowledge base."""
        if not self.initialized:
            await self.initialize()

        if self._pool is None:
            raise RuntimeError("RagService not initialized: database pool is None")

        start_time = time.time()

        async with acquire_with_retry(self._pool) as conn:
            rows = await conn.fetch(
                f"SELECT id FROM {SCHEMA}.documents WHERE file_id = $1",
                file_id,
            )

        if not rows:
            processing_time = (time.time() - start_time) * 1000
            return {
                "success": True,
                "message": f"No documents found with ID '{file_id}'",
                "deleted_count": 0,
                "deleted_data_ids": [],
                "processing_time_ms": processing_time,
            }

        ids_to_delete = [row["id"] for row in rows]

        async with acquire_with_retry(self._pool) as conn, conn.transaction():
            await conn.execute(
                f"DELETE FROM {SCHEMA}.chunks WHERE document_id = ANY($1)",
                ids_to_delete,
            )
            await conn.execute(
                f"DELETE FROM {SCHEMA}.documents WHERE id = ANY($1)",
                ids_to_delete,
            )

        processing_time = (time.time() - start_time) * 1000

        return {
            "success": True,
            "message": f"Deleted {len(ids_to_delete)} document(s) with ID '{file_id}'",
            "deleted_count": len(ids_to_delete),
            "deleted_data_ids": [str(did) for did in ids_to_delete],
            "processing_time_ms": processing_time,
        }

    async def compare_documents(
        self,
        base_file_id: str,
        comparison_file_id: str,
        *,
        max_changes: int = 500,
    ) -> dict[str, Any] | None:
        """Compare two documents using deterministic paragraph-level diffing.

        Returns structured diff with change blocks, or None for individual
        documents that are not found (caller should check which).
        """
        from .diff_service import compute_diff

        base = await self.get_document_content(base_file_id)
        if base is None:
            return {"error": "not_found", "file_id": base_file_id, "role": "base"}

        comp = await self.get_document_content(comparison_file_id)
        if comp is None:
            return {"error": "not_found", "file_id": comparison_file_id, "role": "comparison"}

        diff_result = compute_diff(
            base["content"],
            comp["content"],
            max_changes=max_changes,
        )

        result = diff_result.to_dict()
        result["success"] = True
        result["base_document"] = {
            "file_id": base_file_id,
            "title": base.get("title"),
        }
        result["comparison_document"] = {
            "file_id": comparison_file_id,
            "title": comp.get("title"),
        }

        return result

    async def compare_files(
        self,
        base_bytes: bytes,
        base_filename: str,
        comparison_bytes: bytes,
        comparison_filename: str,
        *,
        max_changes: int = 500,
    ) -> dict[str, Any]:
        """Compare two uploaded files using deterministic paragraph-level diffing.

        Extracts text directly from file bytes — no database storage or embedding.
        """
        self._maybe_refresh_clients()

        from tale_knowledge.extraction import extract_text

        from .diff_service import compute_diff

        base_text, _ = await extract_text(
            base_bytes,
            base_filename,
            vision_client=self._vision_client,
        )
        if not base_text or not base_text.strip():
            raise ValueError(f"No text could be extracted from base file: {base_filename}")

        comp_text, _ = await extract_text(
            comparison_bytes,
            comparison_filename,
            vision_client=self._vision_client,
        )
        if not comp_text or not comp_text.strip():
            raise ValueError(f"No text could be extracted from comparison file: {comparison_filename}")

        diff_result = compute_diff(base_text, comp_text, max_changes=max_changes)

        result = diff_result.to_dict()
        result["success"] = True
        result["base_document"] = {
            "file_id": None,
            "title": base_filename,
        }
        result["comparison_document"] = {
            "file_id": None,
            "title": comparison_filename,
        }

        return result

    async def shutdown(self) -> None:
        """Clean shutdown — close pool."""
        await close_pool()
        self.initialized = False


# Module-level singleton
rag_service = RagService()

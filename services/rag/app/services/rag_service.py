"""Main RAG service replacing CogneeService.

Provides: add_document, search, generate, delete_document, reset.
All operations use the private_knowledge schema in tale_knowledge database.
"""

from __future__ import annotations

import asyncio
import os
import time
from typing import Any

import asyncpg
from loguru import logger
from openai import AsyncOpenAI

from tale_knowledge.embedding import EmbeddingService
from tale_knowledge.vision import VisionCache, VisionClient
from tale_shared.db import acquire_with_retry
from tale_shared.utils.model_list import get_first_model

from ..config import settings
from .database import SCHEMA, close_pool, ensure_embedding_dimensions, get_pool, init_pool
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


class RagService:
    def __init__(self) -> None:
        self.initialized = False
        self._pool: asyncpg.Pool | None = None
        self._embedding_service: EmbeddingService | None = None
        self._vision_client: VisionClient | None = None
        self._openai_client: AsyncOpenAI | None = None
        self._search_service: RagSearchService | None = None

    async def initialize(self) -> None:
        """Initialize database pool, embedding service, vision client, and LLM client."""
        if self.initialized:
            return

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

        # Ensure embedding dimensions and HNSW index
        await ensure_embedding_dimensions(self._pool, dimensions)

        # Vision client (optional — only if model is configured)
        try:
            vision_model = settings.get_vision_model()
            self._vision_client = VisionClient(
                api_key=llm_config["api_key"],
                model=vision_model,
                base_url=llm_config["base_url"],
                timeout=120.0,
                request_timeout=float(settings.vision_request_timeout),
                max_concurrent_pages=settings.vision_max_concurrent_pages,
                pdf_dpi=settings.vision_pdf_dpi,
                ocr_prompt=settings.vision_extraction_prompt,
            )
            logger.info(f"Vision client initialized with model: {vision_model}")
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

        self.initialized = True
        logger.info("RagService initialized")

    async def add_document(
        self,
        content: bytes,
        document_id: str,
        filename: str,
        *,
        user_id: str | None = None,
        team_ids: list[str] | None = None,
    ) -> dict[str, Any]:
        """Add a document to the knowledge base.

        If team_ids has multiple entries, processes each concurrently.
        """
        if not self.initialized:
            await self.initialize()

        assert self._pool is not None
        assert self._embedding_service is not None

        targets: list[tuple[str | None, str | None]] = []
        if user_id:
            targets.append((None, user_id))
        if team_ids:
            for tid in team_ids:
                targets.append((tid, None))

        if not targets:
            raise ValueError("At least one of user_id or team_ids must be provided")

        if len(targets) == 1:
            team_id, uid = targets[0]
            return await index_document(
                self._pool,
                document_id,
                content,
                filename,
                team_id=team_id,
                user_id=uid,
                embedding_service=self._embedding_service,
                vision_client=self._vision_client,
                chunk_size=settings.chunk_size,
                chunk_overlap=settings.chunk_overlap,
            )

        # Multiple targets — process concurrently
        tasks = [
            index_document(
                self._pool,
                document_id,
                content,
                filename,
                team_id=team_id,
                user_id=uid,
                embedding_service=self._embedding_service,
                vision_client=self._vision_client,
                chunk_size=settings.chunk_size,
                chunk_overlap=settings.chunk_overlap,
            )
            for team_id, uid in targets
        ]

        results = await asyncio.gather(*tasks, return_exceptions=True)

        total_chunks = 0
        all_skipped = True
        skip_reason = None
        last_error = None

        for result in results:
            if isinstance(result, Exception):
                last_error = result
                continue
            if not result.get("skipped"):
                all_skipped = False
            total_chunks += result.get("chunks_created", 0)
            if result.get("skip_reason"):
                skip_reason = result["skip_reason"]

        if last_error and total_chunks == 0 and all_skipped:
            raise last_error

        return {
            "success": True,
            "document_id": document_id,
            "chunks_created": total_chunks,
            "skipped": all_skipped,
            "skip_reason": skip_reason if all_skipped else None,
        }

    async def search(
        self,
        query: str,
        *,
        top_k: int | None = None,
        similarity_threshold: float | None = None,
        user_id: str | None = None,
        team_ids: list[str] | None = None,
        **kwargs: Any,
    ) -> list[dict[str, Any]]:
        """Search the knowledge base using hybrid BM25 + vector search."""
        if not self.initialized:
            await self.initialize()

        assert self._search_service is not None

        effective_top_k = top_k or settings.top_k
        threshold = similarity_threshold or settings.similarity_threshold

        results = await self._search_service.search(
            query,
            team_ids=team_ids,
            user_id=user_id,
            top_k=effective_top_k,
        )

        if threshold > 0:
            results = [r for r in results if r.get("score", 0) >= threshold]

        return results

    async def generate(
        self,
        query: str,
        user_id: str | None = None,
        team_ids: list[str] | None = None,
    ) -> dict[str, Any]:
        """Generate a response using RAG: search -> context assembly -> LLM."""
        if not self.initialized:
            await self.initialize()

        assert self._openai_client is not None

        try:
            start_time = time.time()

            search_results = await self.search(query, top_k=RAG_TOP_K, user_id=user_id, team_ids=team_ids)

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
                            f"Context truncated at {total_chars} chars, "
                            f"used {len(context_parts)}/{len(search_results)} chunks"
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
            logger.info(f"Generation completed in {processing_time:.2f}ms")

            return {
                "success": True,
                "response": response,
                "sources": search_results,
                "processing_time_ms": processing_time,
            }

        except Exception as e:
            logger.error(f"Generation failed: {e}")
            raise

    async def delete_document(
        self,
        document_id: str,
        team_ids: list[str] | None = None,
    ) -> dict[str, Any]:
        """Delete a document and its chunks from the knowledge base."""
        if not self.initialized:
            await self.initialize()

        assert self._pool is not None

        start_time = time.time()

        async with acquire_with_retry(self._pool) as conn:
            rows = await conn.fetch(
                f"SELECT id, team_id FROM {SCHEMA}.documents WHERE document_id = $1",
                document_id,
            )

        if not rows:
            processing_time = (time.time() - start_time) * 1000
            return {
                "success": True,
                "message": f"No documents found with ID '{document_id}'",
                "deleted_count": 0,
                "deleted_data_ids": [],
                "processing_time_ms": processing_time,
            }

        ids_to_delete: list[Any] = []
        for row in rows:
            if team_ids and row["team_id"] and row["team_id"] not in team_ids:
                logger.warning(f"Skipping doc {row['id']}: team '{row['team_id']}' not in authorized teams")
                continue
            ids_to_delete.append(row["id"])

        if ids_to_delete:
            async with acquire_with_retry(self._pool) as conn:
                await conn.execute(
                    f"DELETE FROM {SCHEMA}.documents WHERE id = ANY($1)",
                    ids_to_delete,
                )

        processing_time = (time.time() - start_time) * 1000

        return {
            "success": True,
            "message": f"Deleted {len(ids_to_delete)} document(s) with ID '{document_id}'",
            "deleted_count": len(ids_to_delete),
            "deleted_data_ids": [str(did) for did in ids_to_delete],
            "processing_time_ms": processing_time,
        }

    async def reset(self) -> dict[str, Any]:
        """Reset the private_knowledge schema (DROP + recreate).

        Only affects RAG data — crawler data in public_web is untouched.
        """
        if not self.initialized:
            await self.initialize()

        assert self._pool is not None

        async with acquire_with_retry(self._pool) as conn:
            await conn.execute(f"DROP SCHEMA IF EXISTS {SCHEMA} CASCADE")
            await conn.execute(f"CREATE SCHEMA {SCHEMA}")

            # Recreate tables
            await conn.execute(f"""
                CREATE TABLE {SCHEMA}.documents (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    document_id TEXT NOT NULL,
                    filename TEXT,
                    content_hash TEXT,
                    team_id TEXT,
                    user_id TEXT,
                    status TEXT NOT NULL DEFAULT 'processing',
                    chunks_count INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            await conn.execute(f"""
                CREATE UNIQUE INDEX idx_pk_docs_unique_scope
                ON {SCHEMA}.documents(document_id, COALESCE(team_id, ''), COALESCE(user_id, ''))
            """)

            await conn.execute(f"""
                CREATE TABLE {SCHEMA}.chunks (
                    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                    document_id UUID NOT NULL REFERENCES {SCHEMA}.documents(id) ON DELETE CASCADE,
                    team_id TEXT,
                    user_id TEXT,
                    chunk_index INTEGER NOT NULL,
                    chunk_content TEXT NOT NULL,
                    content_hash TEXT NOT NULL,
                    embedding vector,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    UNIQUE(document_id, chunk_index)
                )
            """)

            await conn.execute(f"""
                CREATE TABLE {SCHEMA}.rag_jobs (
                    job_id TEXT PRIMARY KEY,
                    document_id TEXT,
                    state TEXT NOT NULL DEFAULT 'queued',
                    chunks_created INTEGER NOT NULL DEFAULT 0,
                    message TEXT,
                    error TEXT,
                    skipped BOOLEAN NOT NULL DEFAULT FALSE,
                    skip_reason TEXT,
                    created_at DOUBLE PRECISION NOT NULL,
                    updated_at DOUBLE PRECISION NOT NULL
                )
            """)

            # Recreate indexes
            await conn.execute(f"""
                CREATE INDEX idx_pk_docs_docid ON {SCHEMA}.documents(document_id)
            """)
            await conn.execute(f"""
                CREATE INDEX idx_pk_chunks_team ON {SCHEMA}.chunks(team_id)
                WHERE team_id IS NOT NULL
            """)
            await conn.execute(f"""
                CREATE INDEX idx_pk_chunks_user ON {SCHEMA}.chunks(user_id)
                WHERE user_id IS NOT NULL
            """)
            await conn.execute(f"""
                CREATE INDEX idx_pk_jobs_state ON {SCHEMA}.rag_jobs(state)
            """)
            await conn.execute(f"""
                CREATE INDEX idx_pk_jobs_updated ON {SCHEMA}.rag_jobs(updated_at)
            """)

            # BM25 index (may fail if table is empty, that's ok)
            try:
                await conn.execute(f"""
                    CREATE INDEX idx_pk_chunks_bm25 ON {SCHEMA}.chunks
                    USING bm25 (id, chunk_content) WITH (key_field='id')
                """)
            except Exception as e:
                logger.info(f"BM25 index deferred: {e}")

            # Recreate HNSW index function
            await conn.execute(f"""
                CREATE OR REPLACE FUNCTION {SCHEMA}.create_chunks_hnsw_index()
                RETURNS void AS $fn$
                DECLARE col_type text;
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_indexes
                        WHERE schemaname = '{SCHEMA}'
                        AND indexname = 'idx_pk_chunks_embedding_hnsw'
                    ) THEN
                        SELECT format_type(atttypid, atttypmod) INTO col_type
                        FROM pg_attribute
                        WHERE attrelid = '{SCHEMA}.chunks'::regclass AND attname = 'embedding';
                        IF col_type = 'vector' THEN
                            RAISE EXCEPTION '{SCHEMA}.chunks.embedding has no dimensions';
                        END IF;
                        EXECUTE 'CREATE INDEX idx_pk_chunks_embedding_hnsw
                            ON {SCHEMA}.chunks USING hnsw (embedding vector_cosine_ops)
                            WITH (m = 16, ef_construction = 64)';
                    END IF;
                END;
                $fn$ LANGUAGE plpgsql
            """)

        # Re-pin embedding dimensions and recreate HNSW
        dimensions = settings.get_embedding_dimensions()
        await ensure_embedding_dimensions(self._pool, dimensions)

        logger.info("Private knowledge schema reset complete")
        return {"success": True, "message": "Knowledge base reset successfully"}

    async def shutdown(self) -> None:
        """Clean shutdown — close pool."""
        await close_pool()
        self.initialized = False


# Module-level singleton
rag_service = RagService()

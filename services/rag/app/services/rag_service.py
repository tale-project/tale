"""Main RAG service.

Provides: add_document, search, generate, delete_document,
get_document_content, get_document_statuses, compare_documents,
compare_files.

All public methods take `org_slug` as their first argument so the SQL
layer can scope by `org_slug` and the per-org LLM / embedding / vision
clients can be loaded from THAT org's provider catalog at
`<TALE_CONFIG_DIR>/<org>/providers/`. Per-org client state is built
lazily and cached for `_CONFIG_CHECK_INTERVAL` seconds.

Tenant isolation is enforced at the data layer: `documents` and `chunks`
both carry an `org_slug` column (NOT NULL DEFAULT 'default') and a
composite FK ties chunks.org_slug to documents.org_slug. Every SELECT /
UPDATE / DELETE / INSERT filters by `org_slug`.

Embedding **dimensions** are global: the underlying knowledge DB uses
one vector column, so all orgs sharing this RAG instance must use the
same embedding dimensions. The first org to initialize pins the value;
subsequent orgs that disagree raise loudly rather than silently storing
mis-dimensioned vectors. (Per-org dims would require per-org DB schemas
— out of scope.)
"""

from __future__ import annotations

import asyncio
import contextlib
import datetime as dt
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, ClassVar

import asyncpg
import httpx
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

# Bound the per-org-lock dict so a misbehaving caller cannot grow the
# table without limit by spraying random slugs. Real deployments have
# tens, not thousands, of orgs; 256 is comfortably above any realistic
# concurrent-init fan-out while still capping memory.
_ORG_LOCKS_MAX = 256


_background_tasks: set[asyncio.Task[None]] = set()

# When set, every pending `_safe_close` skips its remaining grace
# window and proceeds to the close call immediately. Shutdown sets
# this before draining so the underlying httpx pools actually close
# even when the drain timeout fires — previously the 10s drain
# cancelled the 30s `asyncio.sleep` mid-flight and the close
# coroutine never ran, leaking sockets through process exit
# (round-3 P2 R20-P2-d).
_shutdown_event: asyncio.Event | None = None


def _get_shutdown_event() -> asyncio.Event:
    """Lazy-construct the per-event-loop shutdown event.

    Created on first use rather than at import time so we don't grab a
    handle to the wrong event loop in test environments that spin up
    fresh loops per case.
    """
    global _shutdown_event
    if _shutdown_event is None:
        _shutdown_event = asyncio.Event()
    return _shutdown_event


async def _safe_close(coro) -> None:
    """Close an old client after a grace period for in-flight requests.

    The grace is interruptible: when `_shutdown_event` fires, the sleep
    aborts early and the close runs immediately. Without this, a
    bounded shutdown drain would cancel the `asyncio.sleep(30)` and the
    wrapped close coroutine would never be awaited.
    """
    with contextlib.suppress(TimeoutError):
        await asyncio.wait_for(_get_shutdown_event().wait(), timeout=30)
    try:
        await coro
    except Exception:
        logger.warning("Failed to close old client", exc_info=True)


@dataclass
class _OrgClients:
    """Per-org cached LLM/embedding/vision clients.

    Lifecycle: built lazily on first call for an org, refreshed if older
    than `_CONFIG_CHECK_INTERVAL` AND the underlying provider config has
    changed on disk.
    """

    llm_config: dict
    vision_config: tuple | None
    embedding_service: EmbeddingService
    openai_client: AsyncOpenAI
    vision_client: VisionClient | None
    search_service: RagSearchService
    last_check: float


class RagService:
    def __init__(self) -> None:
        self.initialized = False
        self._init_lock = asyncio.Lock()
        self._pool: asyncpg.Pool | None = None
        # Embedding dimensions are pinned globally; see module docstring.
        # `_pin_dim_lock` serializes the first-write race between two orgs
        # initializing concurrently (which previously each held their own
        # per-org lock and both raced past `if _pinned_dims is None`).
        self._pinned_dims: int | None = None
        self._pin_dim_lock = asyncio.Lock()
        # Per-org client cache and per-org locks (so concurrent first-calls
        # for the same org don't both build clients). True LRU on access:
        # `OrderedDict.move_to_end` on every cache hit; eviction pops the
        # least-recently-used entry. The previous "FIFO" pop-iter scheme
        # claimed to be LRU in comments but never reordered, so a busy
        # org's lock could be evicted while still held by fiber A —
        # fiber B then got a fresh lock and both fibers raced into
        # `_build_or_refresh_org_clients` with `previous=None`, silently
        # overwriting each other's client set with no `_safe_close`
        # scheduled (round-2 P1-20).
        self._org_clients: OrderedDict[str, _OrgClients] = OrderedDict()
        self._org_locks: OrderedDict[str, asyncio.Lock] = OrderedDict()
        # Set to True at the top of `shutdown`. New `_ensure_org_clients`
        # calls raise immediately so requests landing mid-shutdown can't
        # repopulate the cache after `clear()` and bind to a pool that's
        # about to close (round-2 P1-19).
        self._shutting_down: bool = False

    async def initialize(self) -> None:
        """Initialize the shared database pool.

        Per-org client construction is deferred until the first call for
        that org. The DB pool is global — all orgs share one
        knowledge-DB connection pool because the schema is global.
        """
        if self.initialized:
            return

        async with self._init_lock:
            if self.initialized:
                return

            self._pool = await init_pool()
            self.initialized = True
            logger.info("RagService initialized (DB pool ready; per-org clients lazy)")

    @property
    def embedding_service(self) -> EmbeddingService | None:
        """Deprecated: kept for any callers that haven't been threaded
        with `org_slug` yet. Returns None; callers must migrate.
        """
        return None

    def _get_org_lock(self, org_slug: str) -> asyncio.Lock:
        lock = self._org_locks.get(org_slug)
        if lock is not None:
            # True LRU: bump on access. Without this, eviction order is
            # insertion order (FIFO), so a busy org's lock could be
            # evicted while held — breaking the "shared lock per org"
            # invariant and producing the racing-builders bug described
            # on the OrderedDict declaration above.
            self._org_locks.move_to_end(org_slug)
            return lock

        # Bounded eviction: scan for the LEAST-recently-used UNHELD lock
        # rather than blindly popping the head. A held lock means a
        # fiber is mid-build for that org; evicting it would create a
        # second concurrent builder. If every entry is held (>=256 orgs
        # all building concurrently — extremely unlikely), give up on
        # eviction and let the dict grow by one. The next call will
        # have more idle locks to pick from.
        if len(self._org_locks) >= _ORG_LOCKS_MAX:
            for victim_key in list(self._org_locks.keys()):
                victim = self._org_locks[victim_key]
                if not victim.locked():
                    self._org_locks.pop(victim_key, None)
                    break
            # else: all locks held — accept temporary overshoot.
        lock = asyncio.Lock()
        self._org_locks[org_slug] = lock
        return lock

    async def _ensure_org_clients(self, org_slug: str) -> _OrgClients:
        """Lazy-init or refresh an org's clients.

        Refresh is gated on `_CONFIG_CHECK_INTERVAL` so a busy org doesn't
        re-read its provider files on every call.
        """
        if self._shutting_down:
            raise RuntimeError("RagService is shutting down")
        if not self.initialized:
            await self.initialize()
        if self._pool is None:
            raise RuntimeError("RagService not initialized: database pool is None")

        cached = self._org_clients.get(org_slug)
        if cached is not None:
            now = time.monotonic()
            if (now - cached.last_check) < _CONFIG_CHECK_INTERVAL:
                self._org_clients.move_to_end(org_slug)
                return cached

        lock = self._get_org_lock(org_slug)
        async with lock:
            cached = self._org_clients.get(org_slug)
            if cached is not None:
                now = time.monotonic()
                if (now - cached.last_check) < _CONFIG_CHECK_INTERVAL:
                    self._org_clients.move_to_end(org_slug)
                    return cached

            return await self._build_or_refresh_org_clients(org_slug, cached)

    async def _build_or_refresh_org_clients(
        self,
        org_slug: str,
        previous: _OrgClients | None,
    ) -> _OrgClients:
        """Construct fresh clients for org_slug, atomic-swapping if existing."""
        assert self._pool is not None

        llm_config = settings.get_llm_config(org_slug)
        if previous is not None and llm_config == previous.llm_config:
            # No change — refresh the timestamp and reuse.
            previous.last_check = time.monotonic()
            return previous

        if not llm_config.get("api_key") or not llm_config.get("embedding_api_key"):
            if previous is not None:
                logger.warning(
                    "Skipping LLM config reload for org '{}': empty API key",
                    org_slug,
                )
                previous.last_check = time.monotonic()
                return previous
            raise ValueError(f"Org '{org_slug}' has empty chat or embedding API key in provider config.")

        _b, _a, _m, dims = settings.get_embedding_config(org_slug)

        # Serialize the first-write so two concurrent org inits don't
        # race past `_pinned_dims is None` with different dims and both
        # call `pin_embedding_dimensions`. Subsequent calls take the
        # lock too but find `_pinned_dims` already set and fall through
        # to the mismatch check.
        async with self._pin_dim_lock:
            if self._pinned_dims is None:
                self._pinned_dims = dims
                await pin_embedding_dimensions(self._pool, dims)
                logger.info(
                    "Pinned RAG embedding dimensions to {} (set by org '{}')",
                    dims,
                    org_slug,
                )
            elif dims != self._pinned_dims:
                raise ValueError(
                    f"Org '{org_slug}' embedding dimensions ({dims}) do not match the "
                    f"pinned RAG schema dimensions ({self._pinned_dims}). All orgs "
                    f"sharing this RAG instance must use the same embedding model "
                    f"dimensions. Reconcile provider configs or run RAG per-org."
                )

        embedding_service = EmbeddingService(
            api_key=llm_config["embedding_api_key"],
            base_url=llm_config["embedding_base_url"],
            model=llm_config["embedding_model"],
            dimensions=dims,
        )
        openai_client = AsyncOpenAI(
            api_key=llm_config["api_key"],
            base_url=llm_config["base_url"],
            timeout=httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=5.0),
        )

        # Vision client (optional — only if the org has a vision-tagged model)
        vision_client: VisionClient | None = None
        vision_config: tuple | None = None
        try:
            vision_config = settings.get_vision_config(org_slug)
            v_base_url, v_api_key, v_model = vision_config
            if v_api_key:
                vision_client = VisionClient(
                    api_key=v_api_key,
                    model=v_model,
                    base_url=v_base_url,
                    timeout=120.0,
                    request_timeout=float(settings.vision_request_timeout),
                    max_concurrent_pages=settings.vision_max_concurrent_pages,
                    pdf_dpi=settings.vision_pdf_dpi,
                    ocr_prompt=settings.vision_extraction_prompt,
                )
                logger.info(
                    "Vision client initialized for org '{}' with model {}",
                    org_slug,
                    v_model,
                )
        except ValueError:
            logger.debug(
                "No vision model configured for org '{}', Vision disabled",
                org_slug,
            )

        search_service = RagSearchService(self._pool, embedding_service)

        new_clients = _OrgClients(
            llm_config=llm_config,
            vision_config=vision_config,
            embedding_service=embedding_service,
            openai_client=openai_client,
            vision_client=vision_client,
            search_service=search_service,
            last_check=time.monotonic(),
        )
        self._org_clients[org_slug] = new_clients
        self._org_clients.move_to_end(org_slug)

        # Cap `_org_clients` size by the same LRU bound applied to
        # `_org_locks`. Without this, a long-running process that sees
        # many distinct (or typo'd) slugs grows the dict without limit;
        # each entry holds an `AsyncOpenAI` httpx pool + a vision
        # client. Evict the LRU entry whose org isn't in the middle of
        # being built (we hold its lock during this block, so the LRU
        # head won't be us). Round-2 P1-20.
        while len(self._org_clients) > _ORG_LOCKS_MAX:
            victim_key, victim_clients = self._org_clients.popitem(last=False)
            if victim_key == org_slug:
                # Defensive: re-add and stop. Should not happen — the
                # entry we just inserted was move_to_end'd above.
                self._org_clients[victim_key] = victim_clients
                break
            loop = asyncio.get_running_loop()
            for coro_target in (
                victim_clients.embedding_service.close(),
                victim_clients.openai_client.close(),
            ):
                t = loop.create_task(_safe_close(coro_target))
                _background_tasks.add(t)
                t.add_done_callback(_background_tasks.discard)
            if victim_clients.vision_client is not None:
                t = loop.create_task(_safe_close(victim_clients.vision_client.close()))
                _background_tasks.add(t)
                t.add_done_callback(_background_tasks.discard)

        # Best-effort close of old clients after a grace period so in-flight
        # requests on the old clients finish cleanly.
        if previous is not None:
            loop = asyncio.get_running_loop()
            if previous.embedding_service is not embedding_service:
                task = loop.create_task(_safe_close(previous.embedding_service.close()))
                _background_tasks.add(task)
                task.add_done_callback(_background_tasks.discard)
            if previous.openai_client is not openai_client:
                task = loop.create_task(_safe_close(previous.openai_client.close()))
                _background_tasks.add(task)
                task.add_done_callback(_background_tasks.discard)
            if previous.vision_client is not None and previous.vision_client is not vision_client:
                task = loop.create_task(_safe_close(previous.vision_client.close()))
                _background_tasks.add(task)
                task.add_done_callback(_background_tasks.discard)

        logger.info(
            "RAG clients {} for org '{}': model={}",
            "refreshed" if previous else "initialized",
            org_slug,
            llm_config.get("model"),
        )
        return new_clients

    async def add_document(
        self,
        org_slug: str,
        content: bytes,
        file_id: str,
        filename: str,
        *,
        source_created_at: dt.datetime | None = None,
        source_modified_at: dt.datetime | None = None,
    ) -> dict[str, Any]:
        """Add a document to the knowledge base for the given org."""
        clients = await self._ensure_org_clients(org_slug)

        if self._pool is None:
            raise RuntimeError("RagService not initialized: database pool is None")

        return await index_document(
            self._pool,
            org_slug,
            file_id,
            content,
            filename,
            embedding_service=clients.embedding_service,
            vision_client=clients.vision_client,
            chunk_size=settings.chunk_size,
            chunk_overlap=settings.chunk_overlap,
            source_created_at=source_created_at,
            source_modified_at=source_modified_at,
        )

    async def search(
        self,
        org_slug: str,
        query: str,
        *,
        top_k: int | None = None,
        similarity_threshold: float | None = None,
        file_ids: list[str] | None = None,
    ) -> tuple[list[dict[str, Any]], Any]:
        """Search the knowledge base scoped to `org_slug`.

        Returns a `(results, embedding_usage)` tuple — the underlying
        `RagSearchService.search` returns the tuple directly so there's
        no shared singleton attribution race across concurrent callers.
        """
        clients = await self._ensure_org_clients(org_slug)

        effective_top_k = top_k if top_k is not None else settings.top_k
        threshold = similarity_threshold if similarity_threshold is not None else settings.similarity_threshold

        results, usage = await clients.search_service.search(
            org_slug,
            query,
            file_ids=file_ids,
            top_k=effective_top_k,
            similarity_threshold=threshold,
        )

        # If no results and some files are still indexing, wait and retry once
        if not results and file_ids:
            statuses = await self.get_document_statuses(org_slug, file_ids)
            has_processing = any(s is not None and s.get("status") == "processing" for s in statuses.values())
            if has_processing:
                logger.info("No results and some files still indexing, retrying in 3s")
                await asyncio.sleep(3)
                results, usage = await clients.search_service.search(
                    org_slug,
                    query,
                    file_ids=file_ids,
                    top_k=effective_top_k,
                    similarity_threshold=threshold,
                )

        return results, usage

    async def generate(
        self,
        org_slug: str,
        query: str,
        file_ids: list[str] | None = None,
    ) -> dict[str, Any]:
        """Generate a response using RAG: search -> context assembly -> LLM."""
        clients = await self._ensure_org_clients(org_slug)

        try:
            start_time = time.time()

            search_results, embedding_usage = await self.search(org_slug, query, top_k=RAG_TOP_K, file_ids=file_ids)

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

            llm_config = clients.llm_config

            completion = await clients.openai_client.chat.completions.create(
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

            # Combine embedding usage (from search step) + LLM usage.
            # `embedding_usage` is the local var bound from `await
            # self.search(...)` above, so this is correct under
            # concurrent calls.
            embedding_tokens = embedding_usage.prompt_tokens if embedding_usage else 0
            llm_input = completion.usage.prompt_tokens if completion.usage else 0
            llm_output = completion.usage.completion_tokens if completion.usage else 0

            return {
                "success": True,
                "response": response,
                "sources": search_results,
                "processing_time_ms": processing_time,
                "usage": {
                    "input_tokens": embedding_tokens + llm_input,
                    "output_tokens": llm_output,
                    "total_tokens": embedding_tokens + llm_input + llm_output,
                    "model": llm_config["model"],
                },
            }

        except Exception as e:
            logger.error("Generation failed: {}", e)
            raise

    MAX_CHUNK_WINDOW = 200

    async def get_document_content(
        self,
        org_slug: str,
        file_id: str,
        *,
        chunk_start: int = 1,
        chunk_end: int | None = None,
        return_chunks: bool = False,
    ) -> dict[str, Any] | None:
        """Retrieve document content by reassembling stored chunks, scoped to org.

        Returns None for documents that don't exist in `org_slug` — including
        documents that exist for a different org (no cross-tenant disclosure
        via 200 vs 404 differential).
        """
        if not self.initialized:
            await self.initialize()

        if self._pool is None:
            raise RuntimeError("RagService not initialized: database pool is None")

        if chunk_end is None:
            chunk_end = chunk_start + self.MAX_CHUNK_WINDOW - 1

        async with acquire_with_retry(self._pool) as conn:
            doc = await conn.fetchrow(
                f"""SELECT id, file_id, filename, chunks_count,
                           source_created_at, source_modified_at
                    FROM {SCHEMA}.documents
                    WHERE org_slug = $1 AND file_id = $2
                    LIMIT 1""",
                org_slug,
                file_id,
            )

            if doc is None:
                return None

            doc_uuid = doc["id"]
            total_chunks = doc["chunks_count"]

            # Convert 1-indexed API params to 0-indexed chunk_index
            rows = await conn.fetch(
                f"""SELECT chunk_index, chunk_content, core_content
                    FROM {SCHEMA}.chunks
                    WHERE org_slug = $1
                      AND document_id = $2
                      AND chunk_index >= $3
                      AND chunk_index <= $4
                    ORDER BY chunk_index ASC""",
                org_slug,
                doc_uuid,
                chunk_start - 1,
                chunk_end - 1,
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

        # Reassembly: see chunking docs.
        all_migrated = all(row["core_content"] for row in rows)
        if all_migrated:
            combined = "".join(row["core_content"] for row in rows)
        else:
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
            chunk_field = "core_content" if all_migrated else "chunk_content"
            result["chunks"] = [{"index": row["chunk_index"] + 1, "content": row[chunk_field]} for row in rows]

        return result

    async def get_document_statuses(
        self,
        org_slug: str,
        file_ids: list[str],
    ) -> dict[str, dict[str, Any] | None]:
        """Get statuses for multiple documents by file_id, scoped to org.

        Returns a dict mapping file_id → status info, or None for IDs that
        don't exist in `org_slug` (including IDs that exist for a different
        org — those return None too, to avoid cross-tenant disclosure).
        """
        if not self.initialized:
            await self.initialize()

        if self._pool is None:
            raise RuntimeError("RagService not initialized: database pool is None")

        async with acquire_with_retry(self._pool) as conn:
            rows = await conn.fetch(
                f"""
                SELECT DISTINCT ON (file_id)
                    file_id, status, error, progress_phase, progress_detail,
                    source_created_at, source_modified_at, ocr_applied
                FROM {SCHEMA}.documents
                WHERE org_slug = $1 AND file_id = ANY($2)
                ORDER BY file_id,
                    CASE status
                        WHEN 'processing' THEN 0
                        WHEN 'failed' THEN 1
                        WHEN 'completed' THEN 2
                        ELSE 3
                    END,
                    updated_at DESC
                """,
                org_slug,
                file_ids,
            )

        found = {
            row["file_id"]: {
                "status": row["status"],
                "error": row["error"],
                "progress_phase": row["progress_phase"],
                "progress_detail": row["progress_detail"],
                "source_created_at": row["source_created_at"],
                "source_modified_at": row["source_modified_at"],
                "ocr_applied": row["ocr_applied"],
            }
            for row in rows
        }
        return {fid: found.get(fid) for fid in file_ids}

    async def delete_document(
        self,
        org_slug: str,
        file_id: str,
    ) -> dict[str, Any]:
        """Delete a document (and its chunks via FK CASCADE) within `org_slug`.

        Scoped to `org_slug`: a foreign-org file_id will return zero
        deletions rather than touching another tenant's data. The composite
        FK on (document_id, org_slug) means chunks cascade automatically,
        but we still scope the DELETE on chunks first to keep the
        transaction explicit.
        """
        if not self.initialized:
            await self.initialize()

        if self._pool is None:
            raise RuntimeError("RagService not initialized: database pool is None")

        start_time = time.time()

        async with acquire_with_retry(self._pool) as conn:
            rows = await conn.fetch(
                f"""SELECT id FROM {SCHEMA}.documents
                    WHERE org_slug = $1 AND file_id = $2""",
                org_slug,
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
                f"""DELETE FROM {SCHEMA}.chunks
                    WHERE org_slug = $1 AND document_id = ANY($2)""",
                org_slug,
                ids_to_delete,
            )
            await conn.execute(
                f"""DELETE FROM {SCHEMA}.documents
                    WHERE org_slug = $1 AND id = ANY($2)""",
                org_slug,
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
        org_slug: str,
        base_file_id: str,
        comparison_file_id: str,
        *,
        max_changes: int = 500,
    ) -> dict[str, Any] | None:
        """Compare two stored documents (both must belong to `org_slug`)."""
        from .diff_service import compute_diff

        base, comp = await asyncio.gather(
            self.get_document_content(org_slug, base_file_id),
            self.get_document_content(org_slug, comparison_file_id),
        )

        if base is None:
            return {"error": "not_found", "file_id": base_file_id, "role": "base"}
        if comp is None:
            return {
                "error": "not_found",
                "file_id": comparison_file_id,
                "role": "comparison",
            }

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
        org_slug: str,
        base_bytes: bytes,
        base_filename: str,
        comparison_bytes: bytes,
        comparison_filename: str,
        *,
        max_changes: int = 500,
    ) -> dict[str, Any]:
        """Compare two uploaded files using deterministic paragraph-level diffing.

        Extracts text directly from file bytes — uses the org's vision
        client for OCR-able formats. No database storage or embedding.
        """
        clients = await self._ensure_org_clients(org_slug)

        from tale_knowledge.extraction import extract_text

        from .diff_service import compute_diff

        t0 = time.time()

        (base_text, _), (comp_text, _) = await asyncio.gather(
            extract_text(base_bytes, base_filename, vision_client=clients.vision_client),
            extract_text(
                comparison_bytes,
                comparison_filename,
                vision_client=clients.vision_client,
            ),
        )

        extraction_ms = (time.time() - t0) * 1000
        logger.info("Parallel text extraction completed in {:.1f}ms", extraction_ms)

        if not base_text or not base_text.strip():
            raise ValueError(f"No text could be extracted from base file: {base_filename}")

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

    # Bounded drain for background `_safe_close` tasks during shutdown.
    # Each `_safe_close` sleeps 30s before its actual close call so in-
    # flight requests on the old clients can finish; without a timeout
    # here, a refresh-burst right before shutdown can keep the process
    # hanging for ~30s x max-concurrent-refreshes. 10s is generous given
    # the AsyncOpenAI / httpx pool close itself is sub-second.
    _SHUTDOWN_DRAIN_TIMEOUT_S: ClassVar[float] = 10.0

    async def shutdown(self) -> None:
        """Clean shutdown — close pool and all per-org clients.

        Order matters:
        1. Flip `_shutting_down` so new `_ensure_org_clients` calls fail
           fast instead of repopulating the cache and binding new clients
           to a pool that's about to close (P1-19).
        2. Close per-org clients; clear the cache.
        3. Drain `_background_tasks` (the `_safe_close` coroutines that
           were spawned for client-refresh churn) under a bounded timeout.
        4. Close the DB pool.
        """
        self._shutting_down = True
        # Wake every pending `_safe_close` so the underlying client
        # close runs without waiting out its 30s grace — pairs with the
        # interruptible sleep in `_safe_close` to ensure httpx pools are
        # actually torn down before the drain timeout fires.
        _get_shutdown_event().set()

        # Best-effort close of each org's clients before tearing down the pool.
        for org_slug, clients in list(self._org_clients.items()):
            try:
                await clients.embedding_service.close()
            except Exception:
                logger.warning(
                    "Failed to close embedding_service for org '{}'",
                    org_slug,
                    exc_info=True,
                )
            try:
                await clients.openai_client.close()
            except Exception:
                logger.warning("Failed to close openai_client for org '{}'", org_slug, exc_info=True)
            if clients.vision_client is not None:
                try:
                    await clients.vision_client.close()
                except Exception:
                    logger.warning(
                        "Failed to close vision_client for org '{}'",
                        org_slug,
                        exc_info=True,
                    )
        self._org_clients.clear()

        # Drain pending `_safe_close` tasks so they don't keep running
        # after the pool is closed. Bounded by `_SHUTDOWN_DRAIN_TIMEOUT_S`
        # so a refresh burst whose 30s `asyncio.sleep` is still pending
        # can't pin shutdown for the full grace window (P1-19).
        if _background_tasks:
            try:
                await asyncio.wait_for(
                    asyncio.gather(*_background_tasks, return_exceptions=True),
                    timeout=self._SHUTDOWN_DRAIN_TIMEOUT_S,
                )
            except TimeoutError:
                logger.warning(
                    "shutdown: {} background tasks did not drain within {}s; cancelling",
                    len(_background_tasks),
                    self._SHUTDOWN_DRAIN_TIMEOUT_S,
                )
                for task in list(_background_tasks):
                    task.cancel()

        await close_pool()
        self.initialized = False


# Module-level singleton
rag_service = RagService()

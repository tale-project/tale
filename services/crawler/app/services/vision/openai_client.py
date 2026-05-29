"""OpenAI Vision API client for OCR and image description.

This module provides a wrapper around the OpenAI Vision API for:
- OCR: Extracting text from scanned/image-based document pages
- Image description: Generating descriptions of photos, charts, diagrams
- LLM extraction: Processing page content with user instructions

Results are cached based on image content hash to avoid redundant API calls.
"""

import asyncio
import base64
import contextlib
import imghdr
import time
from collections import OrderedDict
from dataclasses import dataclass

from loguru import logger
from openai import AsyncOpenAI

from ...config import settings
from ...org_context import get_active_org
from .cache import compute_text_hash, llm_cache


@dataclass
class UsageAccumulator:
    """Accumulates LLM token usage across multiple API calls."""

    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    duration_ms: int = 0

    def add(self, usage: object | None, duration_ms: int = 0) -> None:
        if usage is None:
            return
        self.input_tokens += getattr(usage, "prompt_tokens", 0) or 0
        self.output_tokens += getattr(usage, "completion_tokens", 0) or 0
        self.total_tokens += getattr(usage, "total_tokens", 0) or 0
        self.duration_ms += duration_ms

    def to_dict(self, model: str | None = None) -> dict:
        d: dict = {
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "total_tokens": self.total_tokens,
            "duration_ms": self.duration_ms,
        }
        if model:
            d["model"] = model
        return d


def _detect_mime_type(image_bytes: bytes) -> str:
    """Detect MIME type from image bytes."""
    img_type = imghdr.what(None, h=image_bytes)
    mime_map = {
        "png": "image/png",
        "jpeg": "image/jpeg",
        "gif": "image/gif",
        "webp": "image/webp",
        "bmp": "image/bmp",
        "tiff": "image/tiff",
    }
    return mime_map.get(img_type, "image/png")


OCR_PROMPT = """Extract ALL text from this document image.
Preserve the original layout and formatting as much as possible.
Include headers, paragraphs, lists, tables, and any other text content.
If there's no readable text, respond with "[No text found]".
Return ONLY the extracted text, nothing else."""

DESCRIBE_PROMPT = """Briefly describe this image in 1-2 short sentences (max 150 characters).
Focus on: image type (photo/chart/diagram), main subject, and key visible text.
Be extremely concise - omit minor details."""


_CONFIG_CHECK_INTERVAL = 15  # seconds


class _OrgVisionState:
    __slots__ = ("client", "config", "last_check")

    def __init__(
        self,
        client: AsyncOpenAI,
        config: tuple,
        last_check: float,
    ) -> None:
        self.client = client
        self.config = config
        self.last_check = last_check


# Per-org cached AsyncOpenAI clients for vision config. Keyed by org slug
# so two orgs' requests never share `_client` / `_client_config` (which
# would route org B's traffic through org A's API key when within the
# TTL — the bug this refactor fixes).
#
# OrderedDict for true LRU on access; bounded by `_ORG_CACHE_MAX` so a
# typo'd-slug spray or natural org churn doesn't leak httpx connection
# pools indefinitely (round-2 P1-25). The peer cache in
# `embedding_service.py` uses the same pattern.
_ORG_CACHE_MAX = 64
_vision_states: OrderedDict[str, _OrgVisionState] = OrderedDict()
_chat_states: OrderedDict[str, _OrgVisionState] = OrderedDict()

# Track outstanding `_safe_close_client` tasks so lifespan shutdown can
# drain them before the event loop closes. Without this set, an
# evicted-or-rotated client sleeps for up to 300 s in a fire-and-forget
# task; when the FastAPI lifespan exits, the loop closes underneath the
# sleeping task, the close never fires, and httpx connection pools
# leak (round-2 P1-26). `app/main.py` lifespan awaits this set on
# shutdown via `drain_pending_close_tasks()`.
_PENDING_CLOSE_TASKS: set[asyncio.Task] = set()


def _schedule_safe_close(client: AsyncOpenAI) -> None:
    """Fire-and-forget close with task-set bookkeeping."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        # No running loop (shutdown in progress, or called from outside
        # an event loop). The caller treats this as best-effort; just
        # close synchronously via a fresh loop would be unsafe, so log
        # the leak instead. The aging pool is closed when the process
        # exits anyway.
        logger.warning(
            "Could not schedule client close — no running event loop; pool will leak until process exit",
        )
        return
    task = loop.create_task(_safe_close_client(client))
    _PENDING_CLOSE_TASKS.add(task)
    task.add_done_callback(_PENDING_CLOSE_TASKS.discard)


async def drain_pending_close_tasks() -> None:
    """Await every still-pending `_safe_close_client` so shutdown can
    flush the 300s grace window without the event loop closing under
    sleeping tasks. Called from `app/main.py` lifespan teardown."""
    if not _PENDING_CLOSE_TASKS:
        return
    pending = list(_PENDING_CLOSE_TASKS)
    for t in pending:
        t.cancel()
    await asyncio.gather(*pending, return_exceptions=True)


async def _safe_close_client(client: AsyncOpenAI) -> None:
    """Close an old client after a grace period for in-flight requests.

    Grace window must cover the longest in-flight request the client
    could be servicing. Vision requests can run up to
    `vision_request_timeout=180s` and chat completions can run for up
    to ~300s; 30s was too short and would tear down the httpx pool
    while a long PDF OCR was still in flight (round-3 P2 R26-P2-b).

    On cancellation (lifespan shutdown drain), close immediately
    without waiting out the grace — the process is exiting, so
    in-flight requests will fail regardless and the FD leak is the
    more important concern.
    """
    with contextlib.suppress(asyncio.CancelledError):
        await asyncio.sleep(300)
    try:
        await client.close()
    except Exception:
        logger.opt(exception=True).warning("Failed to close old vision client")


def _evict_lru_if_needed(
    states: OrderedDict[str, _OrgVisionState],
    label: str,
) -> None:
    """Pop the LRU entry from `states` once it crosses `_ORG_CACHE_MAX`.

    Each entry holds an `AsyncOpenAI` httpx connection pool. Without
    this, a typo'd-slug spray or a long-running process with high org
    churn slowly leaks file descriptors. Schedule the evicted client's
    close after the standard grace window so any in-flight call still
    finishes (round-2 P1-25). The scheduling helper tracks the task
    in `_PENDING_CLOSE_TASKS` so lifespan shutdown can drain it.
    """
    while len(states) > _ORG_CACHE_MAX:
        _victim_key, victim = states.popitem(last=False)
        logger.info("Evicting LRU {} client for org '{}'", label, _victim_key)
        _schedule_safe_close(victim.client)


def _get_or_build_client(
    states: OrderedDict[str, _OrgVisionState],
    org_slug: str,
    config_getter,
    *,
    timeout: float,
    label: str,
) -> AsyncOpenAI:
    """Look up or build the per-org AsyncOpenAI client.

    Mirrors `embedding_service.get_embedding_service` so behavior is
    consistent across crawler services:
      - Within TTL: return cached client without re-reading config.
      - Config read fails: keep the existing client; never silently
        downgrade to an empty key.
      - Config changed: build a new client, schedule the old one to
        close after a grace period so in-flight calls finish.
    """
    state = states.get(org_slug)
    now = time.monotonic()
    if state is not None and (now - state.last_check) < _CONFIG_CHECK_INTERVAL:
        states.move_to_end(org_slug)
        return state.client

    try:
        config = config_getter(org_slug)  # (base_url, api_key, model)
    except (ValueError, OSError):
        if state is not None:
            logger.opt(exception=True).warning(
                "Config read failed for org '{}', keeping current {} client",
                org_slug,
                label,
            )
            state.last_check = now
            return state.client
        raise

    if state is not None and config == state.config:
        state.last_check = now
        return state.client

    base_url, api_key, model = config

    # Never downgrade to empty key
    if not api_key and state is not None:
        logger.warning(
            "Skipping {} reload for org '{}': new config has empty API key",
            label,
            org_slug,
        )
        state.last_check = now
        return state.client

    old_client = state.client if state is not None else None
    new_client = AsyncOpenAI(api_key=api_key, base_url=base_url, timeout=timeout)
    states[org_slug] = _OrgVisionState(
        client=new_client,
        config=config,
        last_check=now,
    )
    states.move_to_end(org_slug)
    _evict_lru_if_needed(states, label)

    if old_client is not None:
        logger.info("{} rebuilt for org '{}': model={}", label, org_slug, model)
        _schedule_safe_close(old_client)
    else:
        logger.info("{} created for org '{}': model={}", label, org_slug, model)

    return new_client


class VisionClient:
    """Async client for OpenAI Vision API calls.

    Stateless wrapper: per-org AsyncOpenAI instances live in the
    module-level `_vision_states` dict, looked up on every call via
    `get_active_org()`. This prevents the previous singleton from
    handing org A's client to org B's request inside the TTL window.
    """

    def _get_client(self) -> AsyncOpenAI:
        return _get_or_build_client(
            _vision_states,
            get_active_org(),
            settings.get_vision_config,
            timeout=120.0,
            label="vision client",
        )

    async def ocr_image(
        self,
        image_bytes: bytes,
        prompt: str | None = None,
        usage: UsageAccumulator | None = None,
    ) -> str:
        """Extract text from a scanned document image using Vision API.

        Args:
            image_bytes: Raw image bytes (PNG, JPG, etc.)
            prompt: Custom OCR prompt (uses default if not provided)

        Returns:
            Extracted text from the image
        """
        cached_result, image_hash = llm_cache.get_ocr(image_bytes)
        if cached_result is not None:
            return cached_result

        # Read the model id from the cached `_vision_states[org].config`
        # tuple instead of `settings.get_vision_model(org)`. The latter
        # routes through `load_providers` which is uncached — every call
        # globs the providers dir, parses JSON, and forks `sops -d` per
        # `.secrets.json`. Multi-page PDF OCR fires this per page, so the
        # sops fork storm dominated. `_get_client` above already loaded
        # the same config and stashed it on the state. (Round-2 P1-26;
        # see `process_pages_with_llm:456` for the same pattern.)
        client = self._get_client()
        org_slug = get_active_org()
        vision_model = _vision_states[org_slug].config[2]
        extraction_prompt = prompt or OCR_PROMPT

        image_b64 = base64.b64encode(image_bytes).decode("utf-8")
        mime_type = _detect_mime_type(image_bytes)

        logger.debug(f"Sending OCR request to {vision_model}")

        try:
            t0 = time.monotonic()
            response = await asyncio.wait_for(
                client.chat.completions.create(
                    model=vision_model,
                    messages=[
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": extraction_prompt},
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": f"data:{mime_type};base64,{image_b64}",
                                    },
                                },
                            ],
                        }
                    ],
                    max_tokens=4096,
                ),
                timeout=settings.vision_request_timeout,
            )
            elapsed_ms = int((time.monotonic() - t0) * 1000)
            if usage:
                usage.add(response.usage, duration_ms=elapsed_ms)

            if not response.choices:
                logger.warning("Vision API returned empty choices for OCR")
                llm_cache.set_ocr(image_hash, "")
                return ""

            result = response.choices[0].message.content or ""

            if result.strip().lower() in ["[no text found]", "no text found", ""]:
                llm_cache.set_ocr(image_hash, "")
                return ""

            logger.debug(f"OCR extracted {len(result)} characters")
            llm_cache.set_ocr(image_hash, result)

            await asyncio.sleep(1)

            return result

        except TimeoutError:
            raise TimeoutError(f"Vision API OCR request timed out after {settings.vision_request_timeout}s") from None
        except Exception as e:
            logger.error(f"Vision API OCR request failed: {e}")
            raise

    async def describe_image(
        self,
        image_bytes: bytes,
        prompt: str | None = None,
        usage: UsageAccumulator | None = None,
    ) -> str:
        """Generate a description of an image for indexing.

        Args:
            image_bytes: Raw image bytes (PNG, JPG, etc.)
            prompt: Custom description prompt (uses default if not provided)

        Returns:
            Description of the image content
        """
        cached_result, image_hash = llm_cache.get_description(image_bytes)
        if cached_result is not None:
            return cached_result

        # Same cached-model-id read as `ocr_image` above. See P1-26 note
        # there for rationale (sops fork storm bypass).
        client = self._get_client()
        org_slug = get_active_org()
        vision_model = _vision_states[org_slug].config[2]
        description_prompt = prompt or DESCRIBE_PROMPT

        image_b64 = base64.b64encode(image_bytes).decode("utf-8")
        mime_type = _detect_mime_type(image_bytes)

        logger.debug(f"Sending image description request to {vision_model}")

        try:
            t0 = time.monotonic()
            response = await asyncio.wait_for(
                client.chat.completions.create(
                    model=vision_model,
                    messages=[
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": description_prompt},
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": f"data:{mime_type};base64,{image_b64}",
                                    },
                                },
                            ],
                        }
                    ],
                    max_tokens=100,
                ),
                timeout=settings.vision_request_timeout,
            )
            elapsed_ms = int((time.monotonic() - t0) * 1000)
            if usage:
                usage.add(response.usage, duration_ms=elapsed_ms)

            if not response.choices:
                logger.warning("Vision API returned empty choices for description")
                llm_cache.set_description(image_hash, "")
                return ""

            result = (response.choices[0].message.content or "").strip()
            logger.debug(f"Generated image description: {len(result)} characters")
            llm_cache.set_description(image_hash, result)

            return result

        except TimeoutError:
            raise TimeoutError(
                f"Vision API describe_image request timed out after {settings.vision_request_timeout}s"
            ) from None
        except Exception as e:
            logger.error(f"Vision API description request failed: {e}")
            raise


def _chunk_by_chars(
    full_text: str,
    max_chars: int = 100_000,
) -> list[tuple[int, str]]:
    """Split text into chunks by character count.

    Tries to split at paragraph boundaries (double newlines) to avoid
    breaking sentences mid-way.

    Args:
        full_text: Complete text to split
        max_chars: Maximum characters per chunk (default 100k)

    Returns:
        List of (chunk_index, chunk_content) tuples
    """
    if len(full_text) <= max_chars:
        return [(0, full_text)]

    chunks: list[tuple[int, str]] = []
    remaining = full_text
    chunk_idx = 0

    while remaining:
        if len(remaining) <= max_chars:
            chunks.append((chunk_idx, remaining.strip()))
            break

        # Try to find a good split point (paragraph boundary)
        split_pos = max_chars
        search_start = max(0, max_chars - 5000)  # Look back up to 5k chars

        # Look for double newline (paragraph break)
        para_break = remaining.rfind("\n\n", search_start, max_chars)
        if para_break > search_start:
            split_pos = para_break + 2  # Include the newlines
        else:
            # Fall back to single newline
            line_break = remaining.rfind("\n", search_start, max_chars)
            if line_break > search_start:
                split_pos = line_break + 1

        chunk_text = remaining[:split_pos].strip()
        if chunk_text:
            chunks.append((chunk_idx, chunk_text))
            chunk_idx += 1

        remaining = remaining[split_pos:]

    return chunks


async def process_pages_with_llm(
    pages_content: list[str],
    user_input: str,
    max_concurrent: int = 3,
    max_chars_per_chunk: int = 30_000,
    model: str | None = None,
    usage: UsageAccumulator | None = None,
) -> list[str]:
    """Process document content with Fast LLM based on user instruction.

    First merges all pages into a single text, then splits by character count
    (default 30k per chunk) for efficient LLM processing. Results are cached
    per chunk so repeated calls with the same content and instruction skip the API.

    Args:
        pages_content: List of page text contents
        user_input: User instruction for extraction
        max_concurrent: Maximum concurrent API calls
        max_chars_per_chunk: Maximum characters per chunk (default 30k)
        usage: Optional accumulator for tracking LLM token usage

    Returns:
        List of processed chunk contents
    """
    if not pages_content:
        return []

    # Merge all pages into one text block
    full_text = "\n\n".join(pages_content)
    total_chars = len(full_text)

    logger.info(f"LLM processing: {total_chars} chars total, chunking at {max_chars_per_chunk} chars")

    org_slug = get_active_org()
    client = _get_or_build_client(
        _chat_states,
        org_slug,
        settings.get_chat_config,
        timeout=300.0,
        label="chat client",
    )
    # `resolved_model` is read from the freshly-cached config to ensure it
    # matches the client we just got back from the per-org cache.
    cached_chat_model = _chat_states[org_slug].config[2]
    resolved_model = model or cached_chat_model
    semaphore = asyncio.Semaphore(max_concurrent)

    chunks = _chunk_by_chars(full_text, max_chars_per_chunk)
    total_chunks = len(chunks)

    logger.info(f"Split into {total_chunks} chunks for LLM processing")

    # Resolve base_url for the cache key so a within-org provider
    # rotation (same model id, different upstream) doesn't serve stale
    # cached outputs from the previous provider. Round-3 P2 R26-P2-d.
    cached_chat_base_url = str(getattr(client, "base_url", "") or "")

    async def process_chunk(chunk_idx: int, chunk_text: str) -> tuple[int, str]:
        cache_key = compute_text_hash(
            chunk_text + "\n---\n" + user_input + "\n---\n" + resolved_model + "\n---\n" + cached_chat_base_url,
        )
        cached = llm_cache.get_llm(cache_key)
        if cached is not None:
            logger.info(f"LLM chunk {chunk_idx + 1}/{total_chunks} cache hit ({len(chunk_text)} chars)")
            return chunk_idx, cached

        async with semaphore:
            try:
                logger.debug(f"Processing chunk {chunk_idx + 1}/{total_chunks} ({len(chunk_text)} chars)")
                t0 = time.monotonic()
                response = await client.chat.completions.create(
                    model=resolved_model,
                    messages=[
                        {
                            "role": "system",
                            "content": (
                                "Extract information from the following document content"
                                " based on user instruction."
                                " Return only the extracted information."
                            ),
                        },
                        {
                            "role": "user",
                            "content": f"Instruction: {user_input}\n\nDocument content:\n{chunk_text}",
                        },
                    ],
                )
                elapsed_ms = int((time.monotonic() - t0) * 1000)
                if usage:
                    usage.add(response.usage, duration_ms=elapsed_ms)
                result = response.choices[0].message.content or ""
                llm_cache.set_llm(cache_key, result)
                logger.info(f"LLM chunk {chunk_idx + 1}/{total_chunks} done: {len(chunk_text)} -> {len(result)} chars")
                return chunk_idx, result
            except Exception as e:
                # Log loud + return empty string. Previously we returned
                # `[LLM_EXTRACTION_FAILED: ...]\n` + raw chunk_text so
                # downstream consumers could "spot the failure", but
                # the marker travelled into embeddings + BM25 index +
                # search results as user-visible content. Embedding
                # the raw fallback text was worse — the unprocessed
                # source carries none of the structure the LLM step
                # was supposed to extract, so search relevance for
                # those chunks regressed silently.
                #
                # The empty-string return drops the chunk entirely
                # from the merged page text; the error log here is
                # the operator-visible signal, and the caller's
                # cache miss (no `set_llm`) means a retry will
                # re-attempt extraction without poisoned state.
                logger.error(
                    f"Failed to process chunk {chunk_idx + 1} with LLM ({type(e).__name__}: {e}); "
                    f"dropping chunk from output (no marker injected into indexed content)",
                )
                return chunk_idx, ""

    tasks = [process_chunk(idx, text) for idx, text in chunks]
    results = await asyncio.gather(*tasks)

    results.sort(key=lambda x: x[0])
    return [r[1] for r in results]


vision_client = VisionClient()

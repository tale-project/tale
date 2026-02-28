"""
Content indexing pipeline: chunk → embed → store in PostgreSQL.

Includes incremental cross-page paragraph deduplication: paragraph
fingerprints are tracked per page, and lines appearing on more than
a threshold number of pages are filtered as boilerplate before chunking.
"""

import asyncio
import hashlib
import logging

import asyncpg

from app.services.chunking_service import chunk_content
from app.services.database import acquire_with_retry
from app.services.embedding_service import EmbeddingService
from app.utils.paragraph_dedup import (
    BOILERPLATE_PAGE_THRESHOLD,
    MIN_DOMAIN_PAGES_FOR_DEDUP,
    extract_paragraph_hashes,
    filter_boilerplate_paragraphs,
)

logger = logging.getLogger(__name__)

INDEXING_CONCURRENCY = 5

_UPSERT_WEBSITE_URL = """\
INSERT INTO website_urls (domain, url, title, content_hash, status, discovered_at, last_crawled_at, metadata)
VALUES ($1, $2, $3, $4, 'active', NOW(), NOW(), jsonb_build_object('filtering_hash', $5::text))
ON CONFLICT (domain, url) DO UPDATE SET
  title = COALESCE(EXCLUDED.title, website_urls.title),
  content_hash = EXCLUDED.content_hash,
  metadata = jsonb_set(COALESCE(website_urls.metadata, '{}'), '{filtering_hash}', to_jsonb($5::text)),
  last_crawled_at = NOW()"""


def _sha256(content: str) -> str:
    return hashlib.sha256(content.encode()).hexdigest()


class IndexingService:
    def __init__(self, pool: asyncpg.Pool, embedding_service: EmbeddingService):
        self._pool = pool
        self._embedding = embedding_service
        self._hnsw_ensured = False

    async def index_page(self, domain: str, url: str, title: str | None, content: str) -> dict:
        content_hash = _sha256(content)
        hashes = extract_paragraph_hashes(content)

        # --- Single connection: hash update + page count query + skip check ---
        page_counts: dict[str, int] = {}
        existing: asyncpg.Record | None = None

        async with acquire_with_retry(self._pool) as conn:
            # Ensure website_url row exists (FK required by page_paragraph_hashes)
            await conn.execute(
                """INSERT INTO website_urls (domain, url, status, discovered_at)
                   VALUES ($1, $2, 'active', NOW())
                   ON CONFLICT (domain, url) DO NOTHING""",
                domain,
                url,
            )
            await conn.execute(
                "DELETE FROM page_paragraph_hashes WHERE domain = $1 AND url = $2",
                domain,
                url,
            )
            if hashes:
                await conn.executemany(
                    "INSERT INTO page_paragraph_hashes (domain, url, paragraph_hash) VALUES ($1, $2, $3)",
                    [(domain, url, h) for h in hashes],
                )

            total_pages = await conn.fetchval(
                "SELECT COUNT(DISTINCT url) FROM page_paragraph_hashes WHERE domain = $1",
                domain,
            )
            if total_pages >= MIN_DOMAIN_PAGES_FOR_DEDUP and hashes:
                rows = await conn.fetch(
                    """SELECT paragraph_hash, COUNT(DISTINCT url) as url_count
                       FROM page_paragraph_hashes
                       WHERE domain = $1 AND paragraph_hash = ANY($2)
                       GROUP BY paragraph_hash""",
                    domain,
                    hashes,
                )
                page_counts = {row["paragraph_hash"]: row["url_count"] for row in rows}

            existing = await conn.fetchrow(
                """SELECT content_hash, metadata->>'filtering_hash' as filtering_hash
                   FROM website_urls WHERE domain = $1 AND url = $2""",
                domain,
                url,
            )

        # --- Pure computation (no DB) ---
        filtered = filter_boilerplate_paragraphs(content, page_counts) if page_counts else content
        filtered_hash = _sha256(filtered)

        if existing and existing["content_hash"] == content_hash and existing["filtering_hash"] == filtered_hash:
            return {"url": url, "status": "skipped", "chunks_indexed": 0}

        # Chunk filtered content
        chunks = chunk_content(filtered, title=title, url=url)
        if not chunks:
            async with acquire_with_retry(self._pool) as conn:
                await conn.execute(_UPSERT_WEBSITE_URL, domain, url, title, content_hash, filtered_hash)
            return {"url": url, "status": "empty", "chunks_indexed": 0}

        # Generate embeddings
        texts = [c.content for c in chunks]
        try:
            embeddings = await self._embedding.embed_texts(texts)
        except Exception:
            logger.exception(f"Embedding failed for {url}")
            return {"url": url, "status": "error", "chunks_indexed": 0, "error": "embedding_failed"}

        # Store in DB (single transaction)
        async with acquire_with_retry(self._pool) as conn, conn.transaction():
            await conn.execute(_UPSERT_WEBSITE_URL, domain, url, title, content_hash, filtered_hash)
            await conn.execute("DELETE FROM chunks WHERE url = $1", url)
            await conn.executemany(
                """INSERT INTO chunks (domain, url, title, content_hash, chunk_index, chunk_content, embedding)
                       VALUES ($1, $2, $3, $4, $5, $6, $7::vector)""",
                [
                    (domain, url, title, content_hash, chunk.index, chunk.content, str(embeddings[i]))
                    for i, chunk in enumerate(chunks)
                ],
            )

        # Ensure HNSW index exists once embeddings are stored
        if not self._hnsw_ensured:
            try:
                async with acquire_with_retry(self._pool) as conn:
                    await conn.execute("SELECT create_chunks_hnsw_index()")
                self._hnsw_ensured = True
            except Exception as e:
                logger.warning("HNSW index creation deferred: %s", e)

        if page_counts:
            boilerplate_count = sum(1 for c in page_counts.values() if c > BOILERPLATE_PAGE_THRESHOLD)
            logger.info("Indexed %d chunks for %s (filtered %d boilerplate lines)", len(chunks), url, boilerplate_count)
        else:
            logger.info("Indexed %d chunks for %s", len(chunks), url)

        return {"url": url, "status": "indexed", "chunks_indexed": len(chunks)}

    async def index_website(self, domain: str) -> dict:
        indexed = 0
        skipped = 0
        failed = 0
        total_chunks = 0
        sem = asyncio.Semaphore(INDEXING_CONCURRENCY)
        page_size = 100
        offset = 0

        while True:
            async with acquire_with_retry(self._pool) as conn:
                rows = await conn.fetch(
                    """SELECT url, title, content FROM website_urls
                       WHERE domain = $1 AND content IS NOT NULL
                       ORDER BY id
                       LIMIT $2 OFFSET $3""",
                    domain,
                    page_size,
                    offset,
                )

            if not rows:
                break

            async def _index_one(row: asyncpg.Record) -> dict:
                async with sem:
                    return await self.index_page(domain, row["url"], row["title"], row["content"])

            results = await asyncio.gather(*[_index_one(row) for row in rows], return_exceptions=True)

            for result in results:
                if isinstance(result, Exception):
                    logger.exception(f"Indexing task failed for {domain}: {result}")
                    failed += 1
                elif result["status"] == "indexed":
                    indexed += 1
                    total_chunks += result["chunks_indexed"]
                elif result["status"] == "skipped":
                    skipped += 1
                else:
                    failed += 1

            offset += page_size

        return {
            "domain": domain,
            "pages_indexed": indexed,
            "pages_skipped": skipped,
            "pages_failed": failed,
            "total_chunks": total_chunks,
        }

    async def delete_page_chunks(self, url: str) -> int:
        async with acquire_with_retry(self._pool) as conn:
            result = await conn.execute("DELETE FROM chunks WHERE url = $1", url)
            count = int(result.split()[-1]) if result else 0
            return count

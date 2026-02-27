"""
Content indexing pipeline: chunk → embed → store in PostgreSQL.
"""

import asyncio
import hashlib
import logging

import asyncpg

from app.services.chunking_service import chunk_content
from app.services.embedding_service import EmbeddingService

logger = logging.getLogger(__name__)

INDEXING_CONCURRENCY = 5


def _sha256(content: str) -> str:
    return hashlib.sha256(content.encode()).hexdigest()


class IndexingService:
    def __init__(self, pool: asyncpg.Pool, embedding_service: EmbeddingService):
        self._pool = pool
        self._embedding = embedding_service
        self._hnsw_ensured = False

    async def index_page(self, domain: str, url: str, title: str | None, content: str) -> dict:
        content_hash = _sha256(content)

        # Check if already indexed with same hash
        async with self._pool.acquire() as conn:
            existing_hash = await conn.fetchval("SELECT content_hash FROM chunks WHERE url = $1 LIMIT 1", url)
            if existing_hash == content_hash:
                return {"url": url, "status": "skipped", "chunks_indexed": 0}

        # Chunk content
        chunks = chunk_content(content, title=title, url=url)
        if not chunks:
            return {"url": url, "status": "empty", "chunks_indexed": 0}

        # Generate embeddings
        texts = [c.content for c in chunks]
        try:
            embeddings = await self._embedding.embed_texts(texts)
        except Exception:
            logger.exception(f"Embedding failed for {url}")
            return {"url": url, "status": "error", "chunks_indexed": 0, "error": "embedding_failed"}

        # Store in DB (ensure website_urls entry exists, delete old chunks → insert new)
        async with self._pool.acquire() as conn, conn.transaction():
            await conn.execute(
                """INSERT INTO website_urls (domain, url, title, content_hash, status, discovered_at, last_crawled_at)
                   VALUES ($1, $2, $3, $4, 'active', NOW(), NOW())
                   ON CONFLICT (domain, url) DO UPDATE SET
                     title = COALESCE(EXCLUDED.title, website_urls.title),
                     content_hash = EXCLUDED.content_hash,
                     last_crawled_at = NOW()""",
                domain,
                url,
                title,
                content_hash,
            )
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
                async with self._pool.acquire() as conn:
                    await conn.execute("SELECT create_chunks_hnsw_index()")
                self._hnsw_ensured = True
            except Exception as e:
                logger.warning("HNSW index creation deferred: %s", e)

        logger.info(f"Indexed {len(chunks)} chunks for {url}")
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
            async with self._pool.acquire() as conn:
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
        async with self._pool.acquire() as conn:
            result = await conn.execute("DELETE FROM chunks WHERE url = $1", url)
            count = int(result.split()[-1]) if result else 0
            return count

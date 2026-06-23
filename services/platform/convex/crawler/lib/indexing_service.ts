'use node';

/**
 * Content indexing pipeline for the crawler corpus (`public_web` schema).
 *
 * Faithful port of `services/crawler/app/services/indexing_service.py`.
 *
 * Pipeline: chunk -> embed -> store in PostgreSQL. Includes incremental
 * cross-page paragraph deduplication: paragraph fingerprints are tracked per
 * page, and lines appearing on more than a threshold number of pages are
 * filtered as boilerplate before chunking.
 *
 * The Python source used a global embedding service via `get_active_org()`;
 * here the org's provider config is resolved explicitly per call and an
 * `EmbeddingService` is built from it.
 */

import type { TransactionSql } from 'postgres';

import {
  chunkContent,
  buildMetadataPrefix,
} from '../../lib/knowledge/chunking/splitter';
import { getEmbeddingConfig } from '../../lib/knowledge/config/base';
import {
  getKnowledgePool,
  PUBLIC_WEB_SCHEMA as SCHEMA,
} from '../../lib/knowledge/db/knowledge_db';
import { withRetry, transactWithRetry } from '../../lib/knowledge/db/retry';
import { EmbeddingService } from '../../lib/knowledge/embedding/service';
import { logger } from '../../lib/knowledge/logger';
import { computeContentHash } from '../../lib/knowledge/utils/hashing';
import {
  BOILERPLATE_PAGE_THRESHOLD,
  MIN_DOMAIN_PAGES_FOR_DEDUP,
  extractParagraphHashes,
  filterBoilerplateParagraphs,
} from './paragraph_dedup';
import { reindexChunks } from './website_store';

const INDEXING_CONCURRENCY = 5;
const _EXECUTEMANY_BATCH_SIZE = 25;

const _UPSERT_WEBSITE_URL = `\
INSERT INTO ${SCHEMA}.website_urls (domain, url, title, content_hash, status, discovered_at, last_crawled_at, metadata)
VALUES ($1, $2, $3, $4, 'active', NOW(), NOW(), jsonb_build_object('filtering_hash', $5::text))
ON CONFLICT (domain, url) DO UPDATE SET
  title = COALESCE(EXCLUDED.title, ${SCHEMA}.website_urls.title),
  content_hash = EXCLUDED.content_hash,
  metadata = jsonb_set(COALESCE(${SCHEMA}.website_urls.metadata, '{}'), '{filtering_hash}', to_jsonb($5::text)),
  last_crawled_at = NOW()`;

const _CHUNK_INSERT = `\
INSERT INTO ${SCHEMA}.chunks (domain, url, title, content_hash, chunk_index, chunk_content, embedding,
                    core_content, prefix_overlap, suffix_overlap)
VALUES ($1, $2, $3, $4, $5, $6, $7::vector, $8, $9, $10)`;

function sha256(content: string): string {
  return computeContentHash(content);
}

export interface IndexPageResult {
  url: string;
  status: 'indexed' | 'skipped' | 'empty' | 'error';
  chunks_indexed: number;
  error?: string;
}

export interface IndexWebsiteResult {
  domain: string;
  pages_indexed: number;
  pages_skipped: number;
  pages_failed: number;
  total_chunks: number;
}

/** Lazily-built per-org embedding service (mirrors the global singleton). */
function buildEmbeddingService(orgSlug: string): EmbeddingService {
  const cfg = getEmbeddingConfig(orgSlug);
  return new EmbeddingService(
    cfg.apiKey,
    cfg.baseUrl,
    cfg.modelId,
    cfg.dimensions,
  );
}

// Track whether the HNSW index was ensured this process lifetime (mirrors the
// `IndexingService._hnsw_ensured` instance flag — process-scoped here).
let hnswEnsured = false;

/** Index a single page: chunk + embed + store. */
export async function indexPage(
  orgSlug: string,
  domain: string,
  url: string,
  title: string | null,
  content: string,
): Promise<IndexPageResult> {
  const sql = getKnowledgePool();
  const contentHash = sha256(content);
  const hashes = extractParagraphHashes(content);

  // --- Hash update + page count query + skip check (transactional + retried) ---
  const { pageCounts, existing } = await transactWithRetry(sql, async (tx) => {
    await tx.unsafe(
      `INSERT INTO ${SCHEMA}.website_urls (domain, url, status, discovered_at)
                   VALUES ($1, $2, 'active', NOW())
                   ON CONFLICT (domain, url) DO NOTHING`,
      [domain, url],
    );
    await tx.unsafe(
      `DELETE FROM ${SCHEMA}.page_paragraph_hashes WHERE domain = $1 AND url = $2`,
      [domain, url],
    );
    if (hashes.length > 0) {
      for (let i = 0; i < hashes.length; i += _EXECUTEMANY_BATCH_SIZE) {
        const batch = hashes.slice(i, i + _EXECUTEMANY_BATCH_SIZE);
        for (const h of batch) {
          await tx.unsafe(
            `INSERT INTO ${SCHEMA}.page_paragraph_hashes (domain, url, paragraph_hash) VALUES ($1, $2, $3)`,
            [domain, url, h],
          );
        }
      }
    }

    const totalPagesRows = await tx.unsafe<{ count: string }[]>(
      `SELECT COUNT(DISTINCT url) FROM ${SCHEMA}.page_paragraph_hashes WHERE domain = $1`,
      [domain],
    );
    const totalPages = Number(totalPagesRows[0]?.count ?? 0);
    const counts: Record<string, number> = {};
    if (totalPages >= MIN_DOMAIN_PAGES_FOR_DEDUP && hashes.length > 0) {
      const rows = await tx.unsafe<
        { paragraph_hash: string; url_count: string }[]
      >(
        `SELECT paragraph_hash, COUNT(DISTINCT url) as url_count
                       FROM ${SCHEMA}.page_paragraph_hashes
                       WHERE domain = $1 AND paragraph_hash = ANY($2)
                       GROUP BY paragraph_hash`,
        [domain, hashes],
      );
      for (const row of rows) {
        counts[row.paragraph_hash] = Number(row.url_count);
      }
    }

    const existingRows = await tx.unsafe<
      { content_hash: string | null; filtering_hash: string | null }[]
    >(
      `SELECT content_hash, metadata->>'filtering_hash' as filtering_hash
                   FROM ${SCHEMA}.website_urls WHERE domain = $1 AND url = $2`,
      [domain, url],
    );
    return { pageCounts: counts, existing: existingRows[0] ?? null };
  });

  // --- Pure computation (no DB) ---
  const hasPageCounts = Object.keys(pageCounts).length > 0;
  const filtered = hasPageCounts
    ? filterBoilerplateParagraphs(content, pageCounts)
    : content;
  const filteredHash = sha256(filtered);

  if (
    existing &&
    existing.content_hash === contentHash &&
    existing.filtering_hash === filteredHash
  ) {
    return { url, status: 'skipped', chunks_indexed: 0 };
  }

  // Chunk filtered content. The chunker no longer takes title/url so the
  // tale_knowledge invariants hold unconditionally. The crawler-specific
  // title/URL prefix is reintroduced below at embed- and storage-time only.
  const chunks = chunkContent(filtered);
  if (chunks.length === 0) {
    await withRetry(() =>
      sql.unsafe(_UPSERT_WEBSITE_URL, [
        domain,
        url,
        title,
        contentHash,
        filteredHash,
      ]),
    );
    return { url, status: 'empty', chunks_indexed: 0 };
  }

  // During Phase 1-3 chunk_content carries the "Title\n\nURL\n\n" prefix so the
  // existing BM25 index over chunk_content continues to surface title/URL
  // keyword hits. core_content stays metadata-free.
  const metadataPrefix = buildMetadataPrefix(title, url);
  const embedTexts = chunks.map((c) => metadataPrefix + c.content);
  let embeddings: number[][];
  try {
    const emb = buildEmbeddingService(orgSlug);
    embeddings = await emb.embedTexts(embedTexts);
  } catch (err) {
    logger.error(
      `Embedding failed for ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return {
      url,
      status: 'error',
      chunks_indexed: 0,
      error: 'embedding_failed',
    };
  }

  // Store in DB (transactional + retried). `chunk_content` keeps the same shape
  // as pre-refactor (prefix + raw chunk text) so the BM25 index doesn't
  // regress; the three new columns hold the clean decomposition.
  const chunkRows = chunks.map((chunk, i) => [
    domain,
    url,
    title,
    contentHash,
    chunk.index,
    embedTexts[i], // chunk_content = prefix + chunk.content
    JSON.stringify(embeddings[i]),
    chunk.coreContent,
    chunk.prefixOverlap,
    chunk.suffixOverlap,
  ]);

  const storeChunks = async (tx: TransactionSql): Promise<void> => {
    await tx.unsafe(_UPSERT_WEBSITE_URL, [
      domain,
      url,
      title,
      contentHash,
      filteredHash,
    ]);
    // Scope by domain too: chunks PK is (domain, url, chunk_index) so two
    // different domains hosting the same URL path don't over-delete each
    // other's chunks.
    await tx.unsafe(
      `DELETE FROM ${SCHEMA}.chunks WHERE domain = $1 AND url = $2`,
      [domain, url],
    );
    for (let i = 0; i < chunkRows.length; i += _EXECUTEMANY_BATCH_SIZE) {
      const batch = chunkRows.slice(i, i + _EXECUTEMANY_BATCH_SIZE);
      for (const row of batch) {
        await tx.unsafe(_CHUNK_INSERT, row);
      }
    }
  };

  try {
    await transactWithRetry(sql, (tx) => storeChunks(tx));
  } catch (exc) {
    logger.warn(
      'Chunk storage failed (possible index corruption), attempting REINDEX and retry: ' +
        (exc instanceof Error ? exc.message : String(exc)),
    );
    await reindexChunks(sql);
    await transactWithRetry(sql, (tx) => storeChunks(tx));
  }

  // Ensure HNSW index exists once embeddings are stored.
  if (!hnswEnsured) {
    try {
      await withRetry(() =>
        sql.unsafe(`SELECT ${SCHEMA}.create_chunks_hnsw_index()`),
      );
      hnswEnsured = true;
    } catch (e) {
      logger.warn(
        `HNSW index creation deferred: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  if (hasPageCounts) {
    const boilerplateCount = Object.values(pageCounts).filter(
      (c) => c > BOILERPLATE_PAGE_THRESHOLD,
    ).length;
    logger.info(
      `Indexed ${chunks.length} chunks for ${url} (filtered ${boilerplateCount} boilerplate lines)`,
    );
  } else {
    logger.info(`Indexed ${chunks.length} chunks for ${url}`);
  }

  return { url, status: 'indexed', chunks_indexed: chunks.length };
}

/** Re-index all pages for a website. */
export async function indexWebsite(
  orgSlug: string,
  domain: string,
): Promise<IndexWebsiteResult> {
  const sql = getKnowledgePool();
  let indexed = 0;
  let skipped = 0;
  let failed = 0;
  let totalChunks = 0;
  const pageSize = 100;
  let offset = 0;

  for (;;) {
    const rows = await withRetry(() =>
      sql.unsafe<{ url: string; title: string | null; content: string }[]>(
        `SELECT url, title, content FROM ${SCHEMA}.website_urls
                       WHERE domain = $1 AND content IS NOT NULL
                       ORDER BY id
                       LIMIT $2 OFFSET $3`,
        [domain, pageSize, offset],
      ),
    );

    if (rows.length === 0) {
      break;
    }

    // Concurrency-bounded fan-out (INDEXING_CONCURRENCY=5), mirroring the
    // asyncio.Semaphore(5) in the Python source.
    const results = await runWithConcurrency(
      rows,
      INDEXING_CONCURRENCY,
      (row) => indexPage(orgSlug, domain, row.url, row.title, row.content),
    );

    for (const result of results) {
      if (result.error !== undefined && result.value === undefined) {
        logger.error(
          `Indexing task failed for ${domain}: ${stringifyError(result.error)}`,
        );
        failed += 1;
      } else if (result.value) {
        const r = result.value;
        if (r.status === 'indexed') {
          indexed += 1;
          totalChunks += r.chunks_indexed;
        } else if (r.status === 'skipped') {
          skipped += 1;
        } else {
          failed += 1;
        }
      }
    }

    offset += pageSize;
  }

  return {
    domain,
    pages_indexed: indexed,
    pages_skipped: skipped,
    pages_failed: failed,
    total_chunks: totalChunks,
  };
}

export interface IndexPageInput {
  url: string;
  title: string | null;
  content: string;
}

/**
 * Index a specific set of already-fetched pages (chunk + embed),
 * concurrency-bounded (INDEXING_CONCURRENCY). Unlike `indexWebsite` — which
 * rescans EVERY crawled page of the domain on each call (O(total), so calling
 * it per batch in the incremental scan loop would be O(n²)) — this touches only
 * the pages passed in (O(batch)). Used by the incremental scan scheduler to
 * index each freshly-fetched batch without re-walking the whole corpus.
 * Indexing failures are logged and counted, never thrown, so one bad page can't
 * abort the batch.
 */
export async function indexPages(
  orgSlug: string,
  domain: string,
  pages: IndexPageInput[],
): Promise<IndexWebsiteResult> {
  let indexed = 0;
  let skipped = 0;
  let failed = 0;
  let totalChunks = 0;

  const results = await runWithConcurrency(
    pages,
    INDEXING_CONCURRENCY,
    (page) => indexPage(orgSlug, domain, page.url, page.title, page.content),
  );

  for (const result of results) {
    if (result.error !== undefined && result.value === undefined) {
      logger.error(
        `Indexing task failed for ${domain}: ${stringifyError(result.error)}`,
      );
      failed += 1;
    } else if (result.value) {
      const r = result.value;
      if (r.status === 'indexed') {
        indexed += 1;
        totalChunks += r.chunks_indexed;
      } else if (r.status === 'skipped') {
        skipped += 1;
      } else {
        failed += 1;
      }
    }
  }

  return {
    domain,
    pages_indexed: indexed,
    pages_skipped: skipped,
    pages_failed: failed,
    total_chunks: totalChunks,
  };
}

interface SettledResult<T> {
  value?: T;
  error?: unknown;
}

/**
 * Render an unknown thrown value as a string without risking the
 * `[object Object]` default-stringification trap (a plain object rejection
 * would otherwise stringify uselessly). Errors use their message; primitives
 * stringify directly; everything else is JSON-encoded best-effort.
 */
function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (
    typeof error === 'string' ||
    typeof error === 'number' ||
    typeof error === 'boolean'
  ) {
    return String(error);
  }
  try {
    return JSON.stringify(error);
  } catch {
    return 'unstringifiable error';
  }
}

/**
 * Run `fn` over `items` with at most `concurrency` in flight, collecting both
 * fulfilled values and rejections (mirrors `asyncio.gather(return_exceptions=True)`).
 */
async function runWithConcurrency<TItem, TOut>(
  items: TItem[],
  concurrency: number,
  fn: (item: TItem) => Promise<TOut>,
): Promise<SettledResult<TOut>[]> {
  const results: SettledResult<TOut>[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const idx = next;
      next += 1;
      if (idx >= items.length) {
        return;
      }
      try {
        results[idx] = { value: await fn(items[idx]) };
      } catch (error) {
        results[idx] = { error };
      }
    }
  };
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

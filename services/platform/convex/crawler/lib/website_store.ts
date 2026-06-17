'use node';

/**
 * PostgreSQL-backed website store for the crawler corpus (`public_web` schema).
 *
 * Faithful port of `services/crawler/app/services/pg_website_store.py`.
 *
 * The Python source split this into two classes:
 *   - `PgWebsiteStore` — per-domain URL operations (scoped by domain column).
 *   - `PgWebsiteStoreManager` — website registry + factory.
 * Both are flattened here into plain async functions that take `domain` as a
 * parameter. postgres.js manages its own connection pool, so there is no
 * acquire/release step — operations are wrapped in `withRetry` / `sql.begin`
 * (transactWithRetry) for transient-fault resilience, exactly mirroring the
 * asyncpg `acquire_with_retry` + `conn.transaction()` pattern.
 *
 * SQL is reproduced byte-for-byte from the Python source, fully-qualified to the
 * `public_web` schema. asyncpg `make_interval` etc. are standard Postgres and
 * stay as-is.
 *
 * Timestamps: postgres.js returns `Date` objects for `timestamptz`. The Python
 * return shapes used epoch *seconds* (`.timestamp()`), so `last_crawled_at` is
 * converted to `date ? date.getTime() / 1000 : null`. JSONB params are passed as
 * `JSON.stringify(obj)` with a `::jsonb` cast (mirrors the RAG port).
 */

import type { Sql } from 'postgres';

import {
  getKnowledgePool,
  PUBLIC_WEB_SCHEMA as SCHEMA,
} from '../../lib/knowledge/db/knowledge_db';
import { withRetry, transactWithRetry } from '../../lib/knowledge/db/retry';
import { logger } from '../../lib/knowledge/logger';

const _BM25_INDEX = `${SCHEMA}.idx_pw_chunks_bm25`;
const _HNSW_INDEX = `${SCHEMA}.idx_pw_chunks_embedding_hnsw`;

/** Convert a postgres.js `Date` (or null) to epoch seconds, matching Python. */
function toEpochSeconds(value: Date | null | undefined): number | null {
  return value ? value.getTime() / 1000 : null;
}

// ---------------------------------------------------------------------------
// Index health (port of services/crawler/app/services/index_health.py)
// ---------------------------------------------------------------------------

/**
 * Rebuild BM25 and HNSW indexes on `public_web.chunks`.
 *
 * REINDEX cannot run inside a transaction, so each index is rebuilt separately
 * on a bare (pooled) connection. Uses plain REINDEX (not CONCURRENTLY) since
 * this runs after bulk deletes or during error recovery where correctness
 * matters more than availability. Missing indexes are logged and skipped.
 */
export async function reindexChunks(sql: Sql): Promise<void> {
  for (const index of [_BM25_INDEX, _HNSW_INDEX]) {
    try {
      await withRetry(() => sql.unsafe(`REINDEX INDEX ${index}`));
      logger.info(`Rebuilt index: ${index}`);
    } catch (err) {
      // 42P01 = undefined_table, 42704 = undefined_object — index absent.
      const code =
        err instanceof Error && 'code' in err && typeof err.code === 'string'
          ? err.code
          : '';
      if (code === '42704' || code === '42P01') {
        logger.debug(`Index ${index} does not exist, skipping`);
      } else {
        logger.error(
          `Failed to rebuild ${index}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Per-domain URL operations (port of PgWebsiteStore)
// ---------------------------------------------------------------------------

export interface DiscoveredUrl {
  url: string;
}

/** Save discovered URLs. Returns number of newly inserted URLs (excludes dupes). */
export async function saveDiscoveredUrls(
  domain: string,
  urls: DiscoveredUrl[],
): Promise<number> {
  if (urls.length === 0) {
    return 0;
  }
  const sql = getKnowledgePool();
  return withRetry(() =>
    sql.begin(async (tx) => {
      const before = await tx.unsafe<{ count: string }[]>(
        `SELECT COUNT(*) FROM ${SCHEMA}.website_urls WHERE domain = $1`,
        [domain],
      );
      const countBefore = Number(before[0]?.count ?? 0);
      for (const u of urls) {
        await tx.unsafe(
          `INSERT INTO ${SCHEMA}.website_urls (domain, url, discovered_at)
                   VALUES ($1, $2, NOW())
                   ON CONFLICT (domain, url) DO NOTHING`,
          [domain, u.url],
        );
      }
      const after = await tx.unsafe<{ count: string }[]>(
        `SELECT COUNT(*) FROM ${SCHEMA}.website_urls WHERE domain = $1`,
        [domain],
      );
      const countAfter = Number(after[0]?.count ?? 0);
      const inserted = countAfter - countBefore;
      logger.info(
        `Saved discovered URLs for ${domain}: ${inserted} new, ${countAfter} total`,
      );
      return inserted;
    }),
  );
}

export interface UrlPageRow {
  url: string;
  content_hash: string | null;
  status: string;
  last_crawled_at: number | null;
}

export async function getUrlsPage(
  domain: string,
  offset = 0,
  limit = 100,
  status?: string | null,
): Promise<UrlPageRow[]> {
  const sql = getKnowledgePool();
  type Row = {
    url: string;
    content_hash: string | null;
    status: string;
    last_crawled_at: Date | null;
  };
  const rows = await withRetry(() => {
    if (status) {
      return sql.unsafe<Row[]>(
        `SELECT url, content_hash, status, last_crawled_at
                       FROM ${SCHEMA}.website_urls
                       WHERE domain = $1 AND content_hash IS NOT NULL AND status = $2
                       ORDER BY id LIMIT $3 OFFSET $4`,
        [domain, status, limit, offset],
      );
    }
    return sql.unsafe<Row[]>(
      `SELECT url, content_hash, status, last_crawled_at
                       FROM ${SCHEMA}.website_urls
                       WHERE domain = $1 AND content_hash IS NOT NULL
                       ORDER BY id LIMIT $2 OFFSET $3`,
      [domain, limit, offset],
    );
  });
  return rows.map((r) => ({
    url: r.url,
    content_hash: r.content_hash,
    status: r.status,
    last_crawled_at: toEpochSeconds(r.last_crawled_at),
  }));
}

export async function getUrlsNeedingRecrawl(
  domain: string,
  limit = 20,
  crawledBefore: number | null = null,
  maxFailCount = 10,
): Promise<string[]> {
  const sql = getKnowledgePool();
  const rows = await withRetry(() => {
    if (crawledBefore !== null) {
      const ts = new Date(crawledBefore * 1000);
      return sql.unsafe<{ url: string }[]>(
        `SELECT url FROM ${SCHEMA}.website_urls
                       WHERE domain = $1 AND status != 'deleted'
                         AND fail_count < $2
                         AND (last_crawled_at IS NULL OR last_crawled_at < $3)
                       ORDER BY CASE WHEN content_hash IS NULL THEN 0 ELSE 1 END,
                              last_crawled_at ASC NULLS FIRST
                       LIMIT $4`,
        [domain, maxFailCount, ts, limit],
      );
    }
    return sql.unsafe<{ url: string }[]>(
      `SELECT url FROM ${SCHEMA}.website_urls
                       WHERE domain = $1 AND status != 'deleted'
                         AND fail_count < $2
                       ORDER BY CASE WHEN content_hash IS NULL THEN 0 ELSE 1 END,
                              last_crawled_at ASC NULLS FIRST
                       LIMIT $3`,
      [domain, maxFailCount, limit],
    );
  });
  return rows.map((r) => r.url);
}

export async function incrementFailCount(
  domain: string,
  urls: string[],
): Promise<void> {
  if (urls.length === 0) {
    return;
  }
  const sql = getKnowledgePool();
  await withRetry(async () => {
    for (const url of urls) {
      await sql.unsafe(
        `UPDATE ${SCHEMA}.website_urls
                   SET fail_count = fail_count + 1, last_crawled_at = NOW()
                   WHERE domain = $1 AND url = $2`,
        [domain, url],
      );
    }
  });
}

export interface ContentHashUpdate {
  url: string;
  content_hash: string;
  status?: string;
  title?: string | null;
  content?: string | null;
  word_count?: number | null;
  metadata?: unknown;
  structured_data?: unknown;
}

export async function updateContentHashes(
  domain: string,
  updates: ContentHashUpdate[],
): Promise<void> {
  if (updates.length === 0) {
    return;
  }
  const sql = getKnowledgePool();
  await withRetry(async () => {
    for (const u of updates) {
      await sql.unsafe(
        `UPDATE ${SCHEMA}.website_urls
                   SET content_hash = $3, status = $4, last_crawled_at = NOW(),
                       title = $5, content = $6, word_count = $7,
                       metadata = $8::jsonb, structured_data = $9::jsonb,
                       fail_count = 0
                   WHERE domain = $1 AND url = $2`,
        [
          domain,
          u.url,
          u.content_hash,
          u.status ?? 'active',
          u.title ?? null,
          u.content ?? null,
          u.word_count ?? null,
          u.metadata == null ? null : JSON.stringify(u.metadata),
          u.structured_data == null ? null : JSON.stringify(u.structured_data),
        ],
      );
    }
  });
}

/**
 * Permanently soft-delete URLs: remove chunks/hashes and clear all content
 * fields. This is a one-way operation — deleted URLs cannot be resurrected by
 * re-discovery (saveDiscoveredUrls uses ON CONFLICT DO NOTHING). Recovery
 * requires manual database intervention.
 */
export async function markUrlsDeleted(
  domain: string,
  urls: string[],
): Promise<void> {
  if (urls.length === 0) {
    return;
  }
  const sql = getKnowledgePool();
  await transactWithRetry(sql, async (tx) => {
    await tx.unsafe(
      `DELETE FROM ${SCHEMA}.chunks WHERE domain = $1 AND url = ANY($2)`,
      [domain, urls],
    );
    await tx.unsafe(
      `DELETE FROM ${SCHEMA}.page_paragraph_hashes WHERE domain = $1 AND url = ANY($2)`,
      [domain, urls],
    );
    await tx.unsafe(
      `UPDATE ${SCHEMA}.website_urls
                   SET status = 'deleted', content_hash = NULL, content = NULL,
                       title = NULL, word_count = NULL, metadata = NULL,
                       structured_data = NULL, etag = NULL, last_modified = NULL
                   WHERE domain = $1 AND url = ANY($2)`,
      [domain, urls],
    );
  });
}

export interface CacheHeader {
  etag: string | null;
  last_modified: string | null;
}

export async function getCacheHeaders(
  domain: string,
  urls: string[],
): Promise<Record<string, CacheHeader>> {
  if (urls.length === 0) {
    return {};
  }
  const sql = getKnowledgePool();
  const rows = await withRetry(() =>
    sql.unsafe<
      { url: string; etag: string | null; last_modified: string | null }[]
    >(
      `SELECT url, etag, last_modified FROM ${SCHEMA}.website_urls
                   WHERE domain = $1 AND url = ANY($2)
                     AND (etag IS NOT NULL OR last_modified IS NOT NULL)`,
      [domain, urls],
    ),
  );
  const result: Record<string, CacheHeader> = {};
  for (const r of rows) {
    result[r.url] = { etag: r.etag, last_modified: r.last_modified };
  }
  return result;
}

export interface CacheHeaderUpdate {
  url: string;
  etag?: string | null;
  last_modified?: string | null;
}

export async function updateCacheHeaders(
  domain: string,
  updates: CacheHeaderUpdate[],
): Promise<void> {
  if (updates.length === 0) {
    return;
  }
  const sql = getKnowledgePool();
  await withRetry(async () => {
    for (const u of updates) {
      await sql.unsafe(
        `UPDATE ${SCHEMA}.website_urls SET etag = $3, last_modified = $4 WHERE domain = $1 AND url = $2`,
        [domain, u.url, u.etag ?? null, u.last_modified ?? null],
      );
    }
  });
}

export async function touchCrawledAt(
  domain: string,
  urls: string[],
): Promise<void> {
  if (urls.length === 0) {
    return;
  }
  const sql = getKnowledgePool();
  await withRetry(async () => {
    for (const url of urls) {
      await sql.unsafe(
        `UPDATE ${SCHEMA}.website_urls SET last_crawled_at = NOW() WHERE domain = $1 AND url = $2`,
        [domain, url],
      );
    }
  });
}

export async function getTotalCount(
  domain: string,
  status?: string | null,
): Promise<number> {
  const sql = getKnowledgePool();
  const rows = await withRetry(() => {
    if (status) {
      return sql.unsafe<{ count: string }[]>(
        `SELECT COUNT(*) FROM ${SCHEMA}.website_urls
                       WHERE domain = $1 AND content_hash IS NOT NULL AND status = $2`,
        [domain, status],
      );
    }
    return sql.unsafe<{ count: string }[]>(
      `SELECT COUNT(*) FROM ${SCHEMA}.website_urls
                   WHERE domain = $1 AND content_hash IS NOT NULL AND status != 'deleted'`,
      [domain],
    );
  });
  return Number(rows[0]?.count ?? 0);
}

export interface CachedPage {
  url: string;
  title: string | null;
  content: string | null;
  word_count: number;
  metadata: unknown;
  structured_data: unknown;
}

export async function getCachedPages(
  domain: string,
  urls: string[],
): Promise<CachedPage[]> {
  if (urls.length === 0) {
    return [];
  }
  const sql = getKnowledgePool();
  type Row = {
    url: string;
    title: string | null;
    content: string | null;
    word_count: number | null;
    metadata: unknown;
    structured_data: unknown;
  };
  const rows = await withRetry(() =>
    sql.unsafe<Row[]>(
      `SELECT url, title, content, word_count, metadata, structured_data
                   FROM ${SCHEMA}.website_urls
                   WHERE domain = $1 AND url = ANY($2) AND content IS NOT NULL`,
      [domain, urls],
    ),
  );
  return rows.map((r) => ({
    url: r.url,
    title: r.title,
    content: r.content,
    word_count: r.word_count ?? 0,
    metadata: r.metadata,
    structured_data: r.structured_data,
  }));
}

export interface PageListItem {
  url: string;
  title: string | null;
  word_count: number;
  status: string;
  content_hash: string | null;
  last_crawled_at: string | null;
  discovered_at: string | null;
  chunks_count: number;
  indexed: boolean;
}

export interface PageListResult {
  pages: PageListItem[];
  total: number;
}

/**
 * List crawled pages for `domain` with their indexing status, paginated.
 *
 * Port of `services/crawler/app/routers/pages.py::list_pages`. Joins each
 * `website_urls` row to its chunk count so the caller can show indexed status.
 */
export async function listPagesWithChunkCount(
  domain: string,
  offset = 0,
  limit = 100,
  status?: string | null,
): Promise<PageListResult> {
  const sql = getKnowledgePool();
  type Row = {
    url: string;
    title: string | null;
    word_count: number | null;
    status: string;
    content_hash: string | null;
    last_crawled_at: Date | null;
    discovered_at: Date | null;
    chunks_count: string;
  };
  const result = await withRetry(async () => {
    const rows = status
      ? await sql.unsafe<Row[]>(
          `SELECT wu.url, wu.title, wu.word_count, wu.status, wu.content_hash,
                  wu.last_crawled_at, wu.discovered_at,
                  COALESCE(c.chunks_count, 0) AS chunks_count
           FROM ${SCHEMA}.website_urls wu
           LEFT JOIN (
             SELECT url, COUNT(*) AS chunks_count
             FROM ${SCHEMA}.chunks GROUP BY url
           ) c ON c.url = wu.url
           WHERE wu.domain = $1 AND wu.content_hash IS NOT NULL AND wu.status = $2
           ORDER BY wu.last_crawled_at DESC NULLS LAST
           LIMIT $3 OFFSET $4`,
          [domain, status, limit, offset],
        )
      : await sql.unsafe<Row[]>(
          `SELECT wu.url, wu.title, wu.word_count, wu.status, wu.content_hash,
                  wu.last_crawled_at, wu.discovered_at,
                  COALESCE(c.chunks_count, 0) AS chunks_count
           FROM ${SCHEMA}.website_urls wu
           LEFT JOIN (
             SELECT url, COUNT(*) AS chunks_count
             FROM ${SCHEMA}.chunks GROUP BY url
           ) c ON c.url = wu.url
           WHERE wu.domain = $1 AND wu.content_hash IS NOT NULL
           ORDER BY wu.last_crawled_at DESC NULLS LAST
           LIMIT $2 OFFSET $3`,
          [domain, limit, offset],
        );
    const totalRows = status
      ? await sql.unsafe<{ count: string }[]>(
          `SELECT COUNT(*) FROM ${SCHEMA}.website_urls wu
           WHERE wu.domain = $1 AND wu.content_hash IS NOT NULL AND wu.status = $2`,
          [domain, status],
        )
      : await sql.unsafe<{ count: string }[]>(
          `SELECT COUNT(*) FROM ${SCHEMA}.website_urls wu
           WHERE wu.domain = $1 AND wu.content_hash IS NOT NULL`,
          [domain],
        );
    return { rows, total: Number(totalRows[0]?.count ?? 0) };
  });

  const pages: PageListItem[] = result.rows.map((r) => {
    const chunksCount = Number(r.chunks_count);
    return {
      url: r.url,
      title: r.title,
      word_count: r.word_count ?? 0,
      status: r.status,
      content_hash: r.content_hash,
      last_crawled_at: r.last_crawled_at
        ? r.last_crawled_at.toISOString()
        : null,
      discovered_at: r.discovered_at ? r.discovered_at.toISOString() : null,
      chunks_count: chunksCount,
      indexed: chunksCount > 0,
    };
  });
  return { pages, total: result.total };
}

export interface PageChunk {
  chunk_index: number;
  chunk_content: string;
  core_content: string;
}

/**
 * Return all indexed chunks for a specific page URL, ordered by chunk index.
 *
 * Port of `services/crawler/app/routers/pages.py::get_page_chunks`.
 */
export async function getPageChunks(
  domain: string,
  url: string,
): Promise<PageChunk[]> {
  const sql = getKnowledgePool();
  const rows = await withRetry(() =>
    sql.unsafe<
      {
        chunk_index: number;
        chunk_content: string;
        core_content: string | null;
      }[]
    >(
      `SELECT chunk_index, chunk_content, core_content
       FROM ${SCHEMA}.chunks
       WHERE domain = $1 AND url = $2
       ORDER BY chunk_index ASC`,
      [domain, url],
    ),
  );
  return rows.map((r) => ({
    chunk_index: r.chunk_index,
    chunk_content: r.chunk_content,
    core_content: r.core_content ?? '',
  }));
}

// ---------------------------------------------------------------------------
// Website registry (port of PgWebsiteStoreManager)
// ---------------------------------------------------------------------------

export interface RegisterWebsiteResult {
  domain: string;
  scan_interval: number;
  status: string;
  first_membership: boolean;
}

/**
 * Register a domain on behalf of `orgSlug`.
 *
 * `websites` is deployment-shared content storage; the per-org boundary lives
 * in `website_org_memberships`. The first org to register a domain creates the
 * website row; subsequent orgs simply join the membership table.
 *
 * Returns `first_membership=true` only when this call is the first to register
 * the domain — callers use it to decide whether to trigger an immediate scan.
 */
export async function registerWebsite(
  domain: string,
  scanInterval = 21600,
  orgSlug?: string,
): Promise<RegisterWebsiteResult> {
  if (!orgSlug) {
    throw new Error('registerWebsite: orgSlug is required');
  }
  const sql = getKnowledgePool();
  const { storedScanInterval, storedStatus, membershipInserted, totalMembers } =
    await transactWithRetry(sql, async (tx) => {
      // ON CONFLICT preserves the existing scan_interval — first-org sets
      // cadence; subsequent orgs joining a tracked domain keep whatever the
      // first org configured. Also flip 'deleting' back to 'idle' since a
      // fresh registration is a clear signal the domain is wanted again.
      const websiteRows = await tx.unsafe<
        { scan_interval: number; status: string }[]
      >(
        `INSERT INTO ${SCHEMA}.websites (domain, scan_interval, created_at, updated_at)
                   VALUES ($1, $2, NOW(), NOW())
                   ON CONFLICT(domain) DO UPDATE SET
                     status = CASE
                       WHEN ${SCHEMA}.websites.status = 'deleting' THEN 'idle'
                       ELSE ${SCHEMA}.websites.status
                     END,
                     updated_at = NOW()
                   RETURNING scan_interval, status`,
        [domain, scanInterval],
      );
      const websiteRow = websiteRows[0];
      // `scan_interval` (INT) and `status` (TEXT) come back already typed by
      // postgres.js — no runtime conversion needed (the row generic above is
      // accurate). Fall back to the requested interval / 'idle' only when the
      // RETURNING clause produced no row (should not happen for an upsert).
      const _storedScanInterval = websiteRow
        ? websiteRow.scan_interval
        : scanInterval;
      const _storedStatus = websiteRow ? websiteRow.status : 'idle';

      // ON CONFLICT DO NOTHING — re-registering from the same org is a no-op.
      // `xmax = 0` is true on a row INSERTed in this command; non-zero on an
      // existing row that hit ON CONFLICT.
      const membershipRows = await tx.unsafe<{ inserted: boolean }[]>(
        `INSERT INTO ${SCHEMA}.website_org_memberships (domain, org_slug)
                   VALUES ($1, $2)
                   ON CONFLICT DO NOTHING
                   RETURNING (xmax = 0) AS inserted`,
        [domain, orgSlug],
      );
      // `inserted` is the boolean `(xmax = 0)` expression — postgres.js types
      // it as `boolean`. `?? false` covers the no-row (ON CONFLICT DO NOTHING)
      // case without a redundant `Boolean()` wrap.
      const _membershipInserted = membershipRows[0]?.inserted ?? false;
      const totalRows = await tx.unsafe<{ count: string }[]>(
        `SELECT COUNT(*) FROM ${SCHEMA}.website_org_memberships WHERE domain = $1`,
        [domain],
      );
      return {
        storedScanInterval: _storedScanInterval,
        storedStatus: _storedStatus,
        membershipInserted: _membershipInserted,
        totalMembers: Number(totalRows[0]?.count ?? 0),
      };
    });

  const firstMembership = membershipInserted && totalMembers === 1;
  logger.info(
    `Registered website: ${domain} for org=${orgSlug} ` +
      `(requested_interval=${scanInterval}s, stored_interval=${storedScanInterval}s, first_membership=${firstMembership})`,
  );
  return {
    domain,
    scan_interval: storedScanInterval,
    status: storedStatus,
    first_membership: firstMembership,
  };
}

export async function updateWebsiteMetadata(
  domain: string,
  title: string | null = null,
  description: string | null = null,
  pageCount: number | null = null,
): Promise<void> {
  const sql = getKnowledgePool();
  await withRetry(() =>
    sql.unsafe(
      `UPDATE ${SCHEMA}.websites SET
                     title = COALESCE($2, title),
                     description = COALESCE($3, description),
                     page_count = COALESCE($4, page_count),
                     updated_at = NOW()
                   WHERE domain = $1`,
      [domain, title, description, pageCount],
    ),
  );
}

export interface BeginDeleteResult {
  removed_membership: boolean;
  removed_website: boolean;
}

/**
 * Remove org's membership of `domain`. If no orgs remain after removal, mark
 * the website itself for deletion (the actual CASCADE happens in
 * `executeDelete`, called from a background task).
 */
export async function beginDelete(
  domain: string,
  orgSlug: string,
): Promise<BeginDeleteResult> {
  const sql = getKnowledgePool();
  return transactWithRetry(sql, async (tx) => {
    // postgres.js exposes the affected row count on the result's `.count`.
    const deleted = await tx.unsafe(
      `DELETE FROM ${SCHEMA}.website_org_memberships WHERE domain = $1 AND org_slug = $2`,
      [domain, orgSlug],
    );
    const removedMembership = (deleted.count ?? 0) > 0;
    const remainingRows = await tx.unsafe<{ count: string }[]>(
      `SELECT COUNT(*) FROM ${SCHEMA}.website_org_memberships WHERE domain = $1`,
      [domain],
    );
    const remaining = Number(remainingRows[0]?.count ?? 0);
    let removedWebsite = false;
    if (remaining === 0) {
      const rows = await tx.unsafe<{ domain: string }[]>(
        `UPDATE ${SCHEMA}.websites SET status = 'deleting', updated_at = NOW() ` +
          `WHERE domain = $1 AND status != 'deleting' RETURNING domain`,
        [domain],
      );
      removedWebsite = rows.length > 0;
    }
    logger.info(
      `begin_delete: domain=${domain} org=${orgSlug} removed_membership=${removedMembership} removed_website=${removedWebsite}`,
    );
    return {
      removed_membership: removedMembership,
      removed_website: removedWebsite,
    };
  });
}

/**
 * Run the actual CASCADE DELETE. Intended for background execution.
 *
 * Same-tx membership re-check: between `beginDelete` marking the row 'deleting'
 * and this firing, a new org could have joined via `registerWebsite`. Takes a
 * row-level lock (SELECT … FOR UPDATE) on the parent `websites` row so a
 * concurrent register's ON CONFLICT DO UPDATE blocks until we commit. If any
 * membership now exists, abort the DELETE and flip status back to 'idle'.
 */
export async function executeDelete(domain: string): Promise<void> {
  const sql = getKnowledgePool();
  const aborted = await transactWithRetry(sql, async (tx) => {
    await tx.unsafe(`SET LOCAL statement_timeout = '120s'`);
    await tx.unsafe(
      `SELECT 1 FROM ${SCHEMA}.websites WHERE domain = $1 FOR UPDATE`,
      [domain],
    );
    const remainingRows = await tx.unsafe<{ count: string }[]>(
      `SELECT COUNT(*) FROM ${SCHEMA}.website_org_memberships WHERE domain = $1`,
      [domain],
    );
    const remaining = Number(remainingRows[0]?.count ?? 0);
    if (remaining > 0) {
      logger.warn(
        `execute_delete: aborting CASCADE for ${domain} — ${remaining} membership(s) ` +
          `appeared after begin_delete (race with register_website). Domain remains live.`,
      );
      await tx.unsafe(
        `UPDATE ${SCHEMA}.websites SET status = 'idle', updated_at = NOW() WHERE domain = $1 AND status = 'deleting'`,
        [domain],
      );
      return true;
    }
    await tx.unsafe(`DELETE FROM ${SCHEMA}.websites WHERE domain = $1`, [
      domain,
    ]);
    return false;
  });
  if (aborted) {
    return;
  }
  await reindexChunks(sql);
  logger.info(`Deleted website: ${domain}`);
}

/** Find domains stuck in 'deleting' status (e.g. after a crash). */
export async function recoverStuckDeletes(): Promise<string[]> {
  const sql = getKnowledgePool();
  const rows = await withRetry(() =>
    sql.unsafe<{ domain: string }[]>(
      `SELECT domain FROM ${SCHEMA}.websites WHERE status = 'deleting'`,
    ),
  );
  return rows.map((r) => r.domain);
}

export interface DueWebsite {
  domain: string;
  status: string;
  scan_interval: number;
  last_scanned_at: Date | null;
  error: string | null;
  owner_org_slug: string;
}

/**
 * Return websites due for scanning, including stuck scans.
 *
 * A website is due when its scan interval has elapsed and it is not currently
 * scanning/deleting, OR it has been stuck in 'scanning' for >2 hours. Each row
 * includes `owner_org_slug` — the slug of the earliest-registering org.
 */
export async function getDueWebsites(): Promise<DueWebsite[]> {
  const sql = getKnowledgePool();
  const rows = await withRetry(() =>
    sql.unsafe<DueWebsite[]>(
      `SELECT w.domain, w.status, w.scan_interval, w.last_scanned_at, w.error,
                          m.org_slug AS owner_org_slug
                   FROM ${SCHEMA}.websites w
                   JOIN LATERAL (
                       SELECT org_slug FROM ${SCHEMA}.website_org_memberships
                       WHERE domain = w.domain
                       ORDER BY added_at ASC, org_slug ASC
                       LIMIT 1
                   ) m ON true
                   WHERE (w.status NOT IN ('scanning', 'deleting')
                          AND (w.last_scanned_at IS NULL
                               OR w.last_scanned_at + make_interval(secs => w.scan_interval) < NOW()))
                      OR (w.status = 'scanning'
                          AND w.updated_at < NOW() - INTERVAL '2 hours')`,
    ),
  );
  return rows;
}

/** True if `orgSlug` has registered `domain` (used by per-org views). */
export async function orgHasMembership(
  domain: string,
  orgSlug: string,
): Promise<boolean> {
  const sql = getKnowledgePool();
  const rows = await withRetry(() =>
    sql.unsafe<{ exists: number }[]>(
      `SELECT 1 AS exists FROM ${SCHEMA}.website_org_memberships WHERE domain = $1 AND org_slug = $2`,
      [domain, orgSlug],
    ),
  );
  return rows.length > 0;
}

/** Return all domains the given org has registered. */
export async function listDomainsForOrg(orgSlug: string): Promise<string[]> {
  const sql = getKnowledgePool();
  const rows = await withRetry(() =>
    sql.unsafe<{ domain: string }[]>(
      `SELECT domain FROM ${SCHEMA}.website_org_memberships WHERE org_slug = $1 ORDER BY domain`,
      [orgSlug],
    ),
  );
  return rows.map((r) => r.domain);
}

export async function updateScanInterval(
  domain: string,
  scanInterval: number,
): Promise<void> {
  const sql = getKnowledgePool();
  await withRetry(() =>
    sql.unsafe(
      `UPDATE ${SCHEMA}.websites SET scan_interval = $2, updated_at = NOW() WHERE domain = $1`,
      [domain, scanInterval],
    ),
  );
}

export async function updateScanStatus(
  domain: string,
  status: string,
  error: string | null = null,
): Promise<void> {
  const sql = getKnowledgePool();
  await withRetry(() =>
    sql.unsafe(
      `UPDATE ${SCHEMA}.websites SET status = $2, error = $3, updated_at = NOW() ` +
        `WHERE domain = $1 AND status != 'deleting'`,
      [domain, status, error],
    ),
  );
}

export async function updateLastScanned(domain: string): Promise<void> {
  const sql = getKnowledgePool();
  await withRetry(() =>
    sql.unsafe(
      `UPDATE ${SCHEMA}.websites SET last_scanned_at = NOW(), updated_at = NOW() WHERE domain = $1`,
      [domain],
    ),
  );
}

export interface WebsiteRecord {
  domain: string;
  title: string | null;
  description: string | null;
  page_count: number | null;
  status: string;
  scan_interval: number;
  last_scanned_at: Date | null;
  error: string | null;
  created_at: Date | null;
  updated_at: Date | null;
  total_urls: number;
  crawled_count: number;
}

export async function getWebsite(
  domain: string,
): Promise<WebsiteRecord | null> {
  const sql = getKnowledgePool();
  // Raw row shape from postgres.js: the `COUNT()`/`COALESCE(COUNT())`
  // aggregates come back as bigint strings, and `page_count` is nullable, so
  // they are typed accurately here and normalized to numbers below. Typing the
  // query as `WebsiteRecord[]` directly would make the conversions look
  // redundant to the type checker while still being load-bearing at runtime.
  type WebsiteRow = Omit<
    WebsiteRecord,
    'page_count' | 'scan_interval' | 'total_urls' | 'crawled_count'
  > & {
    page_count: number | string | null;
    scan_interval: number | string;
    total_urls: string;
    crawled_count: string;
  };
  const rows = await withRetry(() =>
    sql.unsafe<WebsiteRow[]>(
      `SELECT w.domain, w.title, w.description, w.page_count, w.status,
                          w.scan_interval, w.last_scanned_at, w.error,
                          w.created_at, w.updated_at,
                          COALESCE(u.total, 0) AS total_urls,
                          COALESCE(u.crawled, 0) AS crawled_count
                   FROM ${SCHEMA}.websites w
                   LEFT JOIN LATERAL (
                       SELECT COUNT(*) FILTER (WHERE status != 'deleted') AS total,
                              COUNT(*) FILTER (WHERE content_hash IS NOT NULL AND status != 'deleted') AS crawled
                       FROM ${SCHEMA}.website_urls WHERE domain = w.domain
                   ) u ON true
                   WHERE w.domain = $1`,
      [domain],
    ),
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  // postgres.js returns COUNT()/page_count as strings/numbers; normalize.
  return {
    ...row,
    page_count: row.page_count == null ? null : Number(row.page_count),
    scan_interval: Number(row.scan_interval),
    total_urls: Number(row.total_urls),
    crawled_count: Number(row.crawled_count),
  };
}

'use node';

/**
 * The `public_web` corpus, from the websites surface's point of view:
 * registration, status, page/chunk listings, and domain-scoped search.
 *
 * Within one knowledge database a domain is fetched and embedded ONCE;
 * `website_org_memberships` records which organizations asked for it, and
 * every read here that answers to one organization joins (or is guarded)
 * through that membership. An organization on its own database has its own
 * copy of everything — all SQL runs on the pool `getKnowledgePoolForOrg`
 * resolves, never a hard-wired connection.
 *
 * The crawl engine itself lives in `crawl_action.ts`; this module is the
 * data seam both it and `websites/internal_actions.ts` share.
 */

import type { Sql } from 'postgres';

import { PUBLIC_WEB_SCHEMA } from '../../lib/knowledge/types';
import type {
  CrawlerChunk,
  CrawlerPage,
  CrawlerSearchResult,
  CrawlerWebsiteInfo,
} from '../websites/types';

/** How many URLs one scan tracks per domain: discovery stops admitting here,
 * and a longer operator list is truncated (logged, never silent). A bound
 * this size is a runaway backstop, not a coverage budget — real sites index
 * fully; only crawler traps (calendars, faceted search) hit it. */
export const MAX_URLS_PER_DOMAIN = 10_000;

/** URL rows per INSERT when recording a frontier — one statement per URL
 * would turn a large discovery into thousands of round trips. */
export const URL_INSERT_BATCH = 500;

/** Corpus → Convex status vocabulary. The corpus distinguishes `completed`
 * (a finished scan) from `active`; the websites row treats both as a healthy
 * scanned site. */
function toWebsiteStatus(status: string): CrawlerWebsiteInfo['status'] {
  switch (status) {
    case 'scanning':
      return 'scanning';
    case 'error':
      return 'error';
    case 'deleting':
      return 'deleting';
    case 'idle':
      return 'idle';
    default:
      return 'active';
  }
}

/**
 * Register a domain for an organization: upsert the domain row (idle until
 * its first scan) and the membership that makes it visible to this org.
 * Idempotent — re-adding an existing domain only refreshes the interval.
 */
export async function registerDomain(
  sql: Sql,
  orgSlug: string,
  domain: string,
  scanIntervalSeconds: number,
): Promise<void> {
  // `kind = 'site'` on conflict too: kind only ever WIDENS — a domain some
  // org tracked as a URL list becomes a crawled site the moment any org
  // registers the site proper (its listed URLs stay as extra seeds).
  await sql.unsafe(
    `INSERT INTO ${PUBLIC_WEB_SCHEMA}.websites (domain, scan_interval, kind)
     VALUES ($1, $2, 'site')
     ON CONFLICT (domain)
     DO UPDATE SET scan_interval = EXCLUDED.scan_interval, kind = 'site',
                   updated_at = NOW()`,
    [domain, scanIntervalSeconds],
  );
  await sql.unsafe(
    `INSERT INTO ${PUBLIC_WEB_SCHEMA}.website_org_memberships (domain, org_slug)
     VALUES ($1, $2)
     ON CONFLICT (domain, org_slug) DO NOTHING`,
    [domain, orgSlug],
  );
}

/**
 * Register a curated URL list for an organization. The listed rows in
 * `website_urls` ARE the list — there is no separate list table. Idempotent
 * and merging: re-registering adds new URLs and re-marks existing ones as
 * listed. On a domain some org already crawls as a site, the row's kind
 * stays 'site' ('list' never narrows) and the URLs become extra seeds.
 */
export async function registerUrlList(
  sql: Sql,
  orgSlug: string,
  domain: string,
  urls: readonly string[],
  scanIntervalSeconds: number,
): Promise<void> {
  // Dedupe before capping: a repeated line must not eat cap budget, and a
  // multi-row INSERT ... DO UPDATE errors on the same key appearing twice.
  const unique = [...new Set(urls)];
  const admitted = unique.slice(0, MAX_URLS_PER_DOMAIN);
  if (admitted.length < unique.length) {
    console.warn(
      `[crawl] ${domain}: URL list truncated to the ${MAX_URLS_PER_DOMAIN}-URL cap (${unique.length} given)`,
    );
  }
  await sql.unsafe(
    `INSERT INTO ${PUBLIC_WEB_SCHEMA}.websites (domain, scan_interval, kind)
     VALUES ($1, $2, 'list')
     ON CONFLICT (domain)
     DO UPDATE SET scan_interval = EXCLUDED.scan_interval, updated_at = NOW()`,
    [domain, scanIntervalSeconds],
  );
  await sql.unsafe(
    `INSERT INTO ${PUBLIC_WEB_SCHEMA}.website_org_memberships (domain, org_slug)
     VALUES ($1, $2)
     ON CONFLICT (domain, org_slug) DO NOTHING`,
    [domain, orgSlug],
  );
  for (let start = 0; start < admitted.length; start += URL_INSERT_BATCH) {
    const batch = admitted.slice(start, start + URL_INSERT_BATCH);
    const rows = batch
      .map((_, index) => `($1, $${index + 2}, 'discovered', NOW(), TRUE)`)
      .join(', ');
    await sql.unsafe(
      `INSERT INTO ${PUBLIC_WEB_SCHEMA}.website_urls (domain, url, status, discovered_at, listed)
       VALUES ${rows}
       ON CONFLICT (domain, url) DO UPDATE SET listed = TRUE`,
      [domain, ...batch],
    );
  }
}

/** Update the scan cadence on the domain row. */
export async function setScanInterval(
  sql: Sql,
  domain: string,
  scanIntervalSeconds: number,
): Promise<void> {
  await sql.unsafe(
    `UPDATE ${PUBLIC_WEB_SCHEMA}.websites
        SET scan_interval = $2, updated_at = NOW()
      WHERE domain = $1`,
    [domain, scanIntervalSeconds],
  );
}

/**
 * Remove one organization's membership; when it was the last member the
 * domain row goes too, and the FK cascades take the urls, paragraph hashes,
 * and chunks with it. Idempotent.
 */
export async function deregisterDomain(
  sql: Sql,
  orgSlug: string,
  domain: string,
): Promise<void> {
  await sql.unsafe(
    `DELETE FROM ${PUBLIC_WEB_SCHEMA}.website_org_memberships
      WHERE domain = $1 AND org_slug = $2`,
    [domain, orgSlug],
  );
  await sql.unsafe(
    `DELETE FROM ${PUBLIC_WEB_SCHEMA}.websites w
      WHERE w.domain = $1
        AND NOT EXISTS (
          SELECT 1 FROM ${PUBLIC_WEB_SCHEMA}.website_org_memberships m
           WHERE m.domain = w.domain
        )`,
    [domain],
  );
}

/** True when the organization registered this domain — the guard every
 * org-scoped read runs before answering from a domain-keyed table. */
export async function isMemberDomain(
  sql: Sql,
  orgSlug: string,
  domain: string,
): Promise<boolean> {
  const rows = await sql.unsafe<{ ok: number }[]>(
    `SELECT 1 AS ok FROM ${PUBLIC_WEB_SCHEMA}.website_org_memberships
      WHERE domain = $1 AND org_slug = $2 LIMIT 1`,
    [domain, orgSlug],
  );
  return rows.length > 0;
}

/** The corpus-side view of one domain, or null when this organization never
 * registered it (or the corpus has no row yet). */
export async function fetchWebsiteInfoFromCorpus(
  sql: Sql,
  orgSlug: string,
  domain: string,
): Promise<CrawlerWebsiteInfo | null> {
  const rows = await sql.unsafe<
    Array<{
      domain: string;
      kind: string;
      title: string | null;
      description: string | null;
      status: string;
      last_scanned_at: Date | null;
      error: string | null;
      page_count: string;
      crawled_count: string;
    }>
  >(
    `SELECT w.domain, w.kind, w.title, w.description, w.status, w.last_scanned_at,
            w.error,
            (SELECT count(*) FROM ${PUBLIC_WEB_SCHEMA}.website_urls u
              WHERE u.domain = w.domain AND u.status <> 'deleted')::text AS page_count,
            (SELECT count(*) FROM ${PUBLIC_WEB_SCHEMA}.website_urls u
              WHERE u.domain = w.domain AND u.status <> 'deleted'
                AND u.last_crawled_at IS NOT NULL)::text AS crawled_count
       FROM ${PUBLIC_WEB_SCHEMA}.websites w
       JOIN ${PUBLIC_WEB_SCHEMA}.website_org_memberships m
         ON m.domain = w.domain AND m.org_slug = $2
      WHERE w.domain = $1`,
    [domain, orgSlug],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    domain: row.domain,
    kind: row.kind === 'list' ? 'list' : 'site',
    title: row.title,
    description: row.description,
    page_count: Number(row.page_count),
    crawled_count: Number(row.crawled_count),
    status: toWebsiteStatus(row.status),
    last_scanned_at: row.last_scanned_at
      ? row.last_scanned_at.toISOString()
      : null,
    error: row.error,
  };
}

/** One page of a domain's URL inventory, crawl-order newest-known first. */
export async function listWebsitePages(
  sql: Sql,
  domain: string,
  offset: number,
  limit: number,
): Promise<{ pages: CrawlerPage[]; total: number }> {
  const totalRows = await sql.unsafe<{ n: string }[]>(
    `SELECT count(*)::text AS n FROM ${PUBLIC_WEB_SCHEMA}.website_urls
      WHERE domain = $1 AND status <> 'deleted'`,
    [domain],
  );
  const rows = await sql.unsafe<
    Array<{
      url: string;
      title: string | null;
      word_count: number | null;
      status: string;
      content_hash: string | null;
      last_crawled_at: Date | null;
      discovered_at: Date | null;
      chunks_count: string;
    }>
  >(
    `SELECT u.url, u.title, u.word_count, u.status, u.content_hash,
            u.last_crawled_at, u.discovered_at,
            (SELECT count(*) FROM ${PUBLIC_WEB_SCHEMA}.chunks c
              WHERE c.domain = u.domain AND c.url = u.url)::text AS chunks_count
       FROM ${PUBLIC_WEB_SCHEMA}.website_urls u
      WHERE u.domain = $1 AND u.status <> 'deleted'
      ORDER BY u.last_crawled_at DESC NULLS LAST, u.url ASC
      OFFSET $2 LIMIT $3`,
    [domain, offset, limit],
  );
  return {
    total: Number(totalRows[0]?.n ?? 0),
    pages: rows.map((row) => ({
      url: row.url,
      title: row.title,
      word_count: row.word_count ?? 0,
      status: row.status,
      content_hash: row.content_hash,
      last_crawled_at: row.last_crawled_at
        ? row.last_crawled_at.toISOString()
        : null,
      discovered_at: row.discovered_at ? row.discovered_at.toISOString() : null,
      chunks_count: Number(row.chunks_count),
      indexed: Number(row.chunks_count) > 0,
    })),
  };
}

/** The stored chunks of one crawled page, in authored order. */
export async function listPageChunks(
  sql: Sql,
  domain: string,
  url: string,
): Promise<{ chunks: CrawlerChunk[]; total: number }> {
  const rows = await sql.unsafe<
    Array<{ chunk_index: number; chunk_content: string; core_content: string }>
  >(
    `SELECT chunk_index, chunk_content, core_content
       FROM ${PUBLIC_WEB_SCHEMA}.chunks
      WHERE domain = $1 AND url = $2
      ORDER BY chunk_index ASC`,
    [domain, url],
  );
  return {
    total: rows.length,
    chunks: rows.map((row) => ({
      chunk_index: row.chunk_index,
      chunk_content: row.chunk_content,
      core_content: row.core_content,
    })),
  };
}

/** Keyword search within ONE domain (the details dialog's search box).
 * BM25 when ParadeDB is present, ILIKE otherwise — a degraded search is
 * better than a dead box on a database without the extension. */
export async function searchDomainContent(
  sql: Sql,
  domain: string,
  query: string,
  limit: number,
): Promise<{ results: CrawlerSearchResult[]; total: number }> {
  try {
    const rows = await sql.unsafe<
      Array<{
        url: string;
        title: string | null;
        chunk_content: string;
        core_content: string;
        chunk_index: number;
        score: number;
      }>
    >(
      `SELECT c.url, c.title, c.chunk_content, c.core_content, c.chunk_index,
              paradedb.score(c.id) AS score
         FROM ${PUBLIC_WEB_SCHEMA}.chunks c
        WHERE c.domain = $1 AND c.id @@@ paradedb.match('chunk_content', $2)
        ORDER BY score DESC
        LIMIT $3`,
      [domain, query, limit],
    );
    return { results: rows, total: rows.length };
  } catch (error) {
    console.warn(
      `[crawl] BM25 domain search unavailable for ${domain}; falling back to ILIKE:`,
      error instanceof Error ? error.message : error,
    );
    const rows = await sql.unsafe<
      Array<{
        url: string;
        title: string | null;
        chunk_content: string;
        core_content: string;
        chunk_index: number;
      }>
    >(
      `SELECT c.url, c.title, c.chunk_content, c.core_content, c.chunk_index
         FROM ${PUBLIC_WEB_SCHEMA}.chunks c
        WHERE c.domain = $1 AND c.chunk_content ILIKE '%' || $2 || '%'
        ORDER BY c.url, c.chunk_index
        LIMIT $3`,
      [domain, query, limit],
    );
    return {
      results: rows.map((row) => ({ ...row, score: 0 })),
      total: rows.length,
    };
  }
}

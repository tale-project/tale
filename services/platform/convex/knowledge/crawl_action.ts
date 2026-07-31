'use node';

/**
 * The website crawl engine: discover a domain's pages, fetch them politely,
 * strip cross-page boilerplate, and index the text into the `public_web`
 * corpus — chunks (embedded with the organization's model when one is
 * configured) plus the full page text `rag_fetch` serves back.
 *
 * A scan is a CONTINUATION CHAIN, not one long action: a Convex node action
 * is hard-killed near ten minutes without running its catch, so each link
 * crawls for a bounded window and reschedules itself for the rest. The claim
 * on the corpus row (`status = 'scanning'`) is refreshed every link and can
 * be taken over once it goes stale, so a killed scan heals instead of
 * wedging the domain.
 *
 * Everything runs on the pool `getKnowledgePoolForOrg` resolves — an
 * organization's own database when it brought one. On a shared database a
 * domain is crawled once for all member organizations; the claim is what
 * keeps two of them from crawling it concurrently.
 */

import { computeContentHash } from '@tale/shared/utils/hashing';
import { v } from 'convex/values';
import type { Sql } from 'postgres';

import { chunkDocument } from '../../lib/knowledge/chunking';
import {
  extractLinks,
  isDisallowed,
  isSitemapIndex,
  normalizeCandidateUrl,
  paragraphsForHashing,
  parseRobots,
  parseSitemapLocs,
  siteHosts,
  stripBoilerplate,
} from '../../lib/knowledge/crawl-parse';
import { htmlTitle, htmlToText } from '../../lib/knowledge/html-to-text';
import { PUBLIC_WEB_SCHEMA } from '../../lib/knowledge/types';
import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { internalAction } from '../_generated/server';
import { orgSlugFromIdOrNull } from '../lib/helpers/org_slug';
import { safeFetch, SafeFetchError } from '../lib/http/safe_fetch';
import { readOrgEmbeddingConfig } from './connection';
import { pinDimensions } from './dimensions';
import { Embedder, embedderForOrg, EmbeddingNotConfigured } from './embedding';
import { getKnowledgePoolForOrg, resolveOrgUrl } from './pool';

/** One continuation link crawls at most this long before rescheduling —
 * far under the ~10-minute point where the runtime kills a node action
 * without running its catch. */
const SCAN_BUDGET_MS = 300_000;
/** Pause between page fetches; a crawler that hammers a site gets blocked,
 * and these actions share the backend process with everything else. */
const FETCH_DELAY_MS = 500;
/** Pause before the next continuation link. */
const CONTINUATION_DELAY_MS = 5_000;
/** Chain-length backstop; with the page cap below it is never the binding
 * limit unless a site stalls every single fetch. */
const MAX_CONTINUATIONS = 40;

const PAGE_TIMEOUT_MS = 15_000;
const PAGE_MAX_BYTES = 2 * 1024 * 1024;
const SITEMAP_MAX_BYTES = 8 * 1024 * 1024;
const ROBOTS_MAX_BYTES = 256 * 1024;

/** How many URLs one scan will track per domain. Sites larger than this are
 * crawled up to the cap and the truncation is logged, not silent. */
const MAX_URLS_PER_DOMAIN = 200;
/** Sitemap fetches per discovery (indexes recurse one level). */
const MAX_SITEMAP_FETCHES = 10;
/** When sitemaps yield fewer URLs than this, fall back to link-walking. */
const BFS_FALLBACK_THRESHOLD = 10;
const BFS_MAX_DEPTH = 2;
const BFS_FETCH_BUDGET = 30;

/** A URL that failed this many scans in a row stops being fetched. */
const MAX_FETCH_FAILURES = 5;

/** A paragraph seen on at least this many pages of a domain is boilerplate
 * (navigation, footer, cookie banner) and is kept out of the chunks. */
const BOILERPLATE_PAGE_THRESHOLD = 5;
/** Boilerplate detection needs a sample; below this many hashed pages every
 * paragraph is kept. */
const MIN_DOMAIN_PAGES_FOR_DEDUP = 5;

/** A corpus-side claim older than this is a crashed scan, free to take over. */
const STUCK_SCAN_TAKEOVER = '2 hours';

/** How many due websites one scheduler tick kicks off. */
const MAX_SCANS_PER_TICK = 5;
const SCAN_STAGGER_MS = 5_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface ScanIdentity {
  readonly domain: string;
  readonly orgSlug: string;
  readonly organizationId: string;
}

/**
 * Crawl one domain. `continuation === 0` claims the corpus row and runs
 * discovery; every link fetches pages until its budget runs out, indexes
 * what changed, and either reschedules itself or finishes the scan.
 */
export const scanWebsite = internalAction({
  args: {
    domain: v.string(),
    orgSlug: v.string(),
    organizationId: v.string(),
    continuation: v.optional(v.number()),
    scanStartedAt: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const continuation = args.continuation ?? 0;
    const scanStartedAt = args.scanStartedAt ?? new Date().toISOString();
    const identity: ScanIdentity = {
      domain: args.domain,
      orgSlug: args.orgSlug,
      organizationId: args.organizationId,
    };
    const sql = await getKnowledgePoolForOrg(args.orgSlug);

    try {
      if (continuation === 0) {
        const claimed = await claimScan(sql, args.domain);
        if (!claimed) {
          console.log(`[crawl] ${args.domain}: scan already running, skipping`);
          return null;
        }
        await discoverAndRecordUrls(sql, args.domain);
      }

      // Fetch AND index page by page, all inside the budget window. A page is
      // indexed the moment it changes — so a killed action loses at most one
      // page's work, and the next link re-indexes it (unchanged text with no
      // chunks counts as changed).
      const deadline = Date.now() + SCAN_BUDGET_MS;
      const indexer = new PageIndexer(ctx, sql, identity);
      while (Date.now() < deadline) {
        const page = await nextDuePage(sql, args.domain, scanStartedAt);
        if (!page) break;
        const outcome = await fetchAndStorePage(sql, args.domain, page);
        if (outcome === 'changed') await indexer.indexPage(page.url);
        await sleep(FETCH_DELAY_MS);
      }
      await indexer.finish();

      const remaining = await countDuePages(sql, args.domain, scanStartedAt);
      if (remaining > 0 && continuation < MAX_CONTINUATIONS) {
        // Refresh the claim so a long chain is not mistaken for a crash.
        await sql.unsafe(
          `UPDATE ${PUBLIC_WEB_SCHEMA}.websites SET updated_at = NOW() WHERE domain = $1`,
          [args.domain],
        );
        await fanOutRowSync(ctx, sql, args.domain);
        await ctx.scheduler.runAfter(
          CONTINUATION_DELAY_MS,
          internal.knowledge.crawl_action.scanWebsite,
          {
            ...identity,
            continuation: continuation + 1,
            scanStartedAt,
          },
        );
        return null;
      }
      if (remaining > 0) {
        console.warn(
          `[crawl] ${args.domain}: continuation cap reached with ${remaining} pages left; finishing scan early`,
        );
      }

      await sql.unsafe(
        `UPDATE ${PUBLIC_WEB_SCHEMA}.websites
            SET status = 'completed', last_scanned_at = NOW(), error = NULL,
                updated_at = NOW(),
                page_count = (SELECT count(*) FROM ${PUBLIC_WEB_SCHEMA}.website_urls u
                               WHERE u.domain = websites.domain AND u.status <> 'deleted')
          WHERE domain = $1`,
        [args.domain],
      );
      console.log(`[crawl] ${args.domain}: scan finished`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[crawl] ${args.domain}: scan failed:`, message);
      await sql
        .unsafe(
          `UPDATE ${PUBLIC_WEB_SCHEMA}.websites
              SET status = 'error', error = $2, updated_at = NOW()
            WHERE domain = $1`,
          [args.domain, message.slice(0, 1000)],
        )
        .catch((markError: unknown) => {
          console.error(
            `[crawl] ${args.domain}: could not record the failure:`,
            markError,
          );
        });
    }

    await fanOutRowSync(ctx, sql, args.domain);
    return null;
  },
});

/**
 * The five-minute scheduler: find websites whose scan interval has elapsed
 * (or whose scan looks crashed) and start a bounded number of scans. Driven
 * by the Convex `websites` rows — each knows its organization, and the
 * organization names the corpus pool.
 */
export const scanDueWebsites = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    const websites = await ctx.runQuery(
      internal.websites.internal_queries.listWebsitesForScanScheduling,
      {},
    );
    const now = Date.now();
    const due = websites.filter((site) => {
      if (site.status === 'deleting') return false;
      const intervalMs = site.scanIntervalSeconds * 1000;
      if (site.status === 'scanning') {
        // A healthy scan refreshes its corpus claim, not the Convex row —
        // treat a row stuck in `scanning` for two hours as crashed and let
        // the corpus-side claim takeover decide.
        const since = site.lastScannedAt ?? site.createdAt;
        return now - since > 2 * 60 * 60 * 1000;
      }
      if (site.lastScannedAt === undefined) return true;
      return now - site.lastScannedAt > intervalMs;
    });

    const batch = due.slice(0, MAX_SCANS_PER_TICK);
    if (due.length > batch.length) {
      console.log(
        `[crawl] ${due.length} websites due, starting ${batch.length} this tick`,
      );
    }
    for (const [index, site] of batch.entries()) {
      const orgSlug = await orgSlugFromIdOrNull(ctx, site.organizationId);
      if (!orgSlug) continue;
      await ctx.scheduler.runAfter(
        index * SCAN_STAGGER_MS,
        internal.knowledge.crawl_action.scanWebsite,
        {
          domain: site.domain,
          orgSlug,
          organizationId: site.organizationId,
        },
      );
    }
    return null;
  },
});

/** Take the corpus-side claim on a domain, or report that another scan holds
 * it. A claim older than {@link STUCK_SCAN_TAKEOVER} belongs to a crashed
 * scan and is taken over. */
async function claimScan(sql: Sql, domain: string): Promise<boolean> {
  const rows = await sql.unsafe<{ domain: string }[]>(
    `UPDATE ${PUBLIC_WEB_SCHEMA}.websites
        SET status = 'scanning', error = NULL, updated_at = NOW()
      WHERE domain = $1
        AND (status NOT IN ('scanning', 'deleting')
             OR (status = 'scanning' AND updated_at < NOW() - INTERVAL '${STUCK_SCAN_TAKEOVER}'))
      RETURNING domain`,
    [domain],
  );
  return rows.length > 0;
}

/** Discover the domain's URLs (robots.txt sitemaps first, link-walk as the
 * fallback) and record them as `discovered` rows for the fetch loop. */
async function discoverAndRecordUrls(sql: Sql, domain: string): Promise<void> {
  const hosts = siteHosts(domain);
  const baseUrl = `https://${domain}/`;

  let disallow: readonly string[] = [];
  let sitemapCandidates: string[] = [`https://${domain}/sitemap.xml`];
  try {
    const robots = await safeFetch(`https://${domain}/robots.txt`, {
      timeoutMs: PAGE_TIMEOUT_MS,
      maxResponseBytes: ROBOTS_MAX_BYTES,
      allowedHosts: [...hosts],
    });
    if (robots.status >= 200 && robots.status < 300) {
      const rules = parseRobots(robots.body);
      disallow = rules.disallow;
      const advertised = rules.sitemaps.filter((sitemapUrl) => {
        try {
          return hosts.has(new URL(sitemapUrl).hostname.toLowerCase());
        } catch {
          return false;
        }
      });
      if (advertised.length > 0) sitemapCandidates = advertised;
    }
  } catch (error) {
    console.warn(
      `[crawl] ${domain}: robots.txt unavailable, crawling without it:`,
      error instanceof Error ? error.message : error,
    );
  }

  const urls = new Set<string>();
  const admit = (candidate: string): boolean => {
    const normalized = normalizeCandidateUrl(candidate, baseUrl, hosts);
    if (!normalized) return false;
    if (isDisallowed(new URL(normalized).pathname, disallow)) return false;
    if (urls.size >= MAX_URLS_PER_DOMAIN) return true;
    urls.add(normalized);
    return urls.size >= MAX_URLS_PER_DOMAIN;
  };
  admit(baseUrl);

  // Sitemaps: breadth-first over at most MAX_SITEMAP_FETCHES documents,
  // following one level of <sitemapindex> nesting.
  const sitemapQueue = sitemapCandidates.map((url) => ({ url, depth: 0 }));
  let sitemapFetches = 0;
  while (sitemapQueue.length > 0 && sitemapFetches < MAX_SITEMAP_FETCHES) {
    const next = sitemapQueue.shift();
    if (!next) break;
    sitemapFetches += 1;
    let xml: string;
    try {
      const response = await safeFetch(next.url, {
        timeoutMs: PAGE_TIMEOUT_MS,
        maxResponseBytes: SITEMAP_MAX_BYTES,
        allowedHosts: [...hosts],
      });
      if (response.status < 200 || response.status >= 300) continue;
      xml = response.body;
    } catch {
      continue;
    }
    if (isSitemapIndex(xml)) {
      if (next.depth < 2) {
        for (const loc of parseSitemapLocs(xml)) {
          sitemapQueue.push({ url: loc, depth: next.depth + 1 });
        }
      }
      continue;
    }
    let capped = false;
    for (const loc of parseSitemapLocs(xml)) {
      capped = admit(loc);
      if (capped) break;
    }
    if (capped) break;
  }

  // Link-walk fallback for sites without a useful sitemap.
  if (urls.size < BFS_FALLBACK_THRESHOLD) {
    const queue: Array<{ url: string; depth: number }> = [
      { url: baseUrl, depth: 0 },
    ];
    const visited = new Set<string>();
    let fetches = 0;
    while (queue.length > 0 && fetches < BFS_FETCH_BUDGET) {
      const next = queue.shift();
      if (!next || visited.has(next.url)) continue;
      visited.add(next.url);
      fetches += 1;
      try {
        const response = await safeFetch(next.url, {
          timeoutMs: PAGE_TIMEOUT_MS,
          maxResponseBytes: PAGE_MAX_BYTES,
          allowedHosts: [...hosts],
        });
        if (response.status < 200 || response.status >= 300) continue;
        for (const href of extractLinks(response.body)) {
          const normalized = normalizeCandidateUrl(href, next.url, hosts);
          if (!normalized) continue;
          if (isDisallowed(new URL(normalized).pathname, disallow)) continue;
          if (urls.size < MAX_URLS_PER_DOMAIN) urls.add(normalized);
          if (next.depth + 1 <= BFS_MAX_DEPTH && !visited.has(normalized)) {
            queue.push({ url: normalized, depth: next.depth + 1 });
          }
        }
      } catch {
        continue;
      }
      await sleep(FETCH_DELAY_MS);
    }
  }

  if (urls.size >= MAX_URLS_PER_DOMAIN) {
    console.warn(
      `[crawl] ${domain}: URL cap of ${MAX_URLS_PER_DOMAIN} reached; larger sites are crawled partially`,
    );
  }

  for (const url of urls) {
    await sql.unsafe(
      `INSERT INTO ${PUBLIC_WEB_SCHEMA}.website_urls (domain, url, status, discovered_at)
       VALUES ($1, $2, 'discovered', NOW())
       ON CONFLICT (domain, url) DO NOTHING`,
      [domain, url],
    );
  }
  console.log(`[crawl] ${domain}: ${urls.size} URLs discovered`);
}

interface DuePage {
  readonly url: string;
  readonly etag: string | null;
  readonly last_modified: string | null;
  readonly content_hash: string | null;
}

const DUE_PAGE_PREDICATE = `
      domain = $1 AND status <> 'deleted' AND fail_count < ${MAX_FETCH_FAILURES}
      AND (last_crawled_at IS NULL OR last_crawled_at < $2::timestamptz)`;

/** The next URL this scan has not visited yet (never-crawled first). */
async function nextDuePage(
  sql: Sql,
  domain: string,
  scanStartedAt: string,
): Promise<DuePage | null> {
  const rows = await sql.unsafe<DuePage[]>(
    `SELECT url, etag, last_modified, content_hash
       FROM ${PUBLIC_WEB_SCHEMA}.website_urls
      WHERE ${DUE_PAGE_PREDICATE}
      ORDER BY last_crawled_at ASC NULLS FIRST, url ASC
      LIMIT 1`,
    [domain, scanStartedAt],
  );
  return rows[0] ?? null;
}

async function countDuePages(
  sql: Sql,
  domain: string,
  scanStartedAt: string,
): Promise<number> {
  const rows = await sql.unsafe<{ n: string }[]>(
    `SELECT count(*)::text AS n FROM ${PUBLIC_WEB_SCHEMA}.website_urls
      WHERE ${DUE_PAGE_PREDICATE}`,
    [domain, scanStartedAt],
  );
  return Number(rows[0]?.n ?? 0);
}

type FetchOutcome = 'changed' | 'unchanged' | 'failed';

/**
 * Fetch one page (conditionally when the last crawl stored a validator) and
 * store its text, title, and paragraph hashes. Reports whether the content
 * changed — only changed pages are re-chunked and re-embedded.
 */
async function fetchAndStorePage(
  sql: Sql,
  domain: string,
  page: DuePage,
): Promise<FetchOutcome> {
  const hosts = siteHosts(domain);
  const conditional: Record<string, string> = { accept: 'text/html' };
  if (page.etag) conditional['if-none-match'] = page.etag;
  if (page.last_modified) conditional['if-modified-since'] = page.last_modified;

  let response;
  try {
    response = await safeFetch(page.url, {
      headers: conditional,
      timeoutMs: PAGE_TIMEOUT_MS,
      maxResponseBytes: PAGE_MAX_BYTES,
      allowedHosts: [...hosts],
    });
  } catch (error) {
    const message =
      error instanceof SafeFetchError || error instanceof Error
        ? error.message
        : String(error);
    console.warn(`[crawl] ${page.url}: fetch failed: ${message}`);
    await recordPageFailure(sql, domain, page.url);
    return 'failed';
  }

  if (response.status === 304) {
    await sql.unsafe(
      `UPDATE ${PUBLIC_WEB_SCHEMA}.website_urls
          SET last_crawled_at = NOW(), fail_count = 0
        WHERE domain = $1 AND url = $2`,
      [domain, page.url],
    );
    return 'unchanged';
  }
  if (response.status === 404 || response.status === 410) {
    // The page is gone — drop it from the index. Discovery being partial
    // (BFS depth, the URL cap) means absence from a scan proves nothing,
    // but a 404 from the site itself does.
    await sql.begin(async (tx) => {
      await tx.unsafe(
        `DELETE FROM ${PUBLIC_WEB_SCHEMA}.chunks WHERE domain = $1 AND url = $2`,
        [domain, page.url],
      );
      await tx.unsafe(
        `DELETE FROM ${PUBLIC_WEB_SCHEMA}.page_paragraph_hashes
          WHERE domain = $1 AND url = $2`,
        [domain, page.url],
      );
      await tx.unsafe(
        `UPDATE ${PUBLIC_WEB_SCHEMA}.website_urls
            SET status = 'deleted', content = NULL, last_crawled_at = NOW()
          WHERE domain = $1 AND url = $2`,
        [domain, page.url],
      );
    });
    return 'unchanged';
  }
  if (response.status < 200 || response.status >= 300) {
    await recordPageFailure(sql, domain, page.url);
    return 'failed';
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType !== '' && !/text\/html|text\/plain|xhtml/.test(contentType)) {
    // Not a text page (an image, a feed, a download) — remember we looked so
    // the scan moves on, but store nothing.
    await sql.unsafe(
      `UPDATE ${PUBLIC_WEB_SCHEMA}.website_urls
          SET last_crawled_at = NOW(), fail_count = 0
        WHERE domain = $1 AND url = $2`,
      [domain, page.url],
    );
    return 'unchanged';
  }

  const title = htmlTitle(response.body);
  const text = htmlToText(response.body);
  const contentHash = computeContentHash(text);
  const wordCount = text.split(/\s+/).filter((word) => word.length > 0).length;
  const etag = response.headers.get('etag');
  const lastModified = response.headers.get('last-modified');

  const unchanged = page.content_hash === contentHash;
  await sql.begin(async (tx) => {
    await tx.unsafe(
      `UPDATE ${PUBLIC_WEB_SCHEMA}.website_urls
          SET content = $3, title = $4, content_hash = $5, word_count = $6,
              status = 'active', last_crawled_at = NOW(), fail_count = 0,
              etag = $7, last_modified = $8
        WHERE domain = $1 AND url = $2`,
      [
        domain,
        page.url,
        text,
        title,
        contentHash,
        wordCount,
        etag,
        lastModified,
      ],
    );
    await tx.unsafe(
      `DELETE FROM ${PUBLIC_WEB_SCHEMA}.page_paragraph_hashes
        WHERE domain = $1 AND url = $2`,
      [domain, page.url],
    );
    const hashes = new Set(
      paragraphsForHashing(text).map((paragraph) =>
        computeContentHash(paragraph),
      ),
    );
    for (const hash of hashes) {
      await tx.unsafe(
        `INSERT INTO ${PUBLIC_WEB_SCHEMA}.page_paragraph_hashes (domain, url, paragraph_hash)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [domain, page.url, hash],
      );
    }
  });

  if (unchanged) {
    // Same text as last scan — but if its chunks are missing (an earlier
    // scan died between fetching and indexing), index it anyway.
    const chunkRows = await sql.unsafe<{ ok: number }[]>(
      `SELECT 1 AS ok FROM ${PUBLIC_WEB_SCHEMA}.chunks
        WHERE domain = $1 AND url = $2 LIMIT 1`,
      [domain, page.url],
    );
    return chunkRows.length > 0 ? 'unchanged' : 'changed';
  }
  return 'changed';
}

async function recordPageFailure(
  sql: Sql,
  domain: string,
  url: string,
): Promise<void> {
  await sql.unsafe(
    `UPDATE ${PUBLIC_WEB_SCHEMA}.website_urls
        SET fail_count = fail_count + 1, last_crawled_at = NOW()
      WHERE domain = $1 AND url = $2`,
    [domain, url],
  );
}

/**
 * Indexes changed pages one at a time, as the fetch loop hands them over —
 * fetch and index share the budget window, so no phase of a scan can outgrow
 * the action's hard kill.
 *
 * The embedding model is resolved lazily on the first page (a scan where
 * nothing changed never touches the provider) and the boilerplate ledger is
 * re-read per page, so each page is filtered against every paragraph hash
 * stored so far. Without an embedding model the chunks are stored with NULL
 * vectors — the BM25 leg and `rag_fetch` still work, and the dense leg fills
 * in on the re-scan after a model is configured.
 */
class PageIndexer {
  private embedder: Embedder | null = null;
  private embedderResolved = false;
  private indexedAny = false;

  constructor(
    private readonly ctx: ActionCtx,
    private readonly sql: Sql,
    private readonly identity: ScanIdentity,
  ) {}

  private async resolveEmbedder(): Promise<Embedder | null> {
    if (this.embedderResolved) return this.embedder;
    this.embedderResolved = true;
    const { domain, orgSlug, organizationId } = this.identity;
    try {
      const config = await readOrgEmbeddingConfig(orgSlug);
      this.embedder = await embedderForOrg(this.ctx, {
        organizationId,
        orgSlug,
        config,
      });
    } catch (error) {
      if (error instanceof EmbeddingNotConfigured) {
        console.warn(
          `[crawl] ${domain}: no embedding model configured for "${orgSlug}" — indexing for keyword search only`,
        );
      } else {
        throw error;
      }
    }
    if (this.embedder) {
      const dbUrl = await resolveOrgUrl(orgSlug);
      await pinDimensions({
        sql: this.sql,
        dbUrl,
        schema: PUBLIC_WEB_SCHEMA,
        dimensions: this.embedder.dimensions,
        context: `organization "${orgSlug}" (website crawl)`,
      });
    }
    return this.embedder;
  }

  async indexPage(url: string): Promise<void> {
    const { domain } = this.identity;
    const rows = await this.sql.unsafe<
      Array<{ content: string | null; title: string | null }>
    >(
      `SELECT content, title FROM ${PUBLIC_WEB_SCHEMA}.website_urls
        WHERE domain = $1 AND url = $2`,
      [domain, url],
    );
    const row = rows[0];
    if (!row?.content) return;
    this.indexedAny = true;

    const boilerplate = await boilerplateHashes(this.sql, domain);
    const filtered = stripBoilerplate(
      row.content,
      boilerplate,
      computeContentHash,
    );
    const chunks = chunkDocument(filtered, { title: row.title ?? url });
    if (chunks.length === 0) {
      await this.sql.unsafe(
        `DELETE FROM ${PUBLIC_WEB_SCHEMA}.chunks WHERE domain = $1 AND url = $2`,
        [domain, url],
      );
      return;
    }
    const embedder = await this.resolveEmbedder();
    const vectors = embedder
      ? await embedder.embedAll(chunks.map((chunk) => chunk.embedText))
      : null;
    const contentHash = computeContentHash(row.content);

    await this.sql.begin(async (tx) => {
      await tx.unsafe(
        `DELETE FROM ${PUBLIC_WEB_SCHEMA}.chunks WHERE domain = $1 AND url = $2`,
        [domain, url],
      );
      for (const [position, chunk] of chunks.entries()) {
        await tx.unsafe(
          `INSERT INTO ${PUBLIC_WEB_SCHEMA}.chunks
              (domain, url, title, content_hash, chunk_index, chunk_content,
               embedding, context_header, core_content, prefix_overlap, suffix_overlap)
           VALUES ($1, $2, $3, $4, $5, $6, $7::vector, $8, $9, $10, $11)`,
          [
            domain,
            url,
            row.title,
            contentHash,
            chunk.index,
            chunk.embedText,
            vectors ? JSON.stringify(vectors[position]) : null,
            chunk.header,
            chunk.core,
            chunk.prefixOverlap,
            chunk.suffixOverlap,
          ],
        );
      }
    });
  }

  /** Post-loop bookkeeping: the homepage's title names the site itself. */
  async finish(): Promise<void> {
    if (!this.indexedAny) return;
    const { domain } = this.identity;
    const homepageRows = await this.sql.unsafe<Array<{ title: string | null }>>(
      `SELECT title FROM ${PUBLIC_WEB_SCHEMA}.website_urls
        WHERE domain = $1 AND url = $2`,
      [domain, `https://${domain}/`],
    );
    const title = homepageRows[0]?.title;
    if (title) {
      await this.sql.unsafe(
        `UPDATE ${PUBLIC_WEB_SCHEMA}.websites
            SET title = $2, updated_at = NOW()
          WHERE domain = $1`,
        [domain, title],
      );
    }
  }
}

/** The paragraph hashes that qualify as boilerplate for this domain. */
async function boilerplateHashes(
  sql: Sql,
  domain: string,
): Promise<Set<string>> {
  const pagesRows = await sql.unsafe<{ n: string }[]>(
    `SELECT count(DISTINCT url)::text AS n
       FROM ${PUBLIC_WEB_SCHEMA}.page_paragraph_hashes
      WHERE domain = $1`,
    [domain],
  );
  if (Number(pagesRows[0]?.n ?? 0) < MIN_DOMAIN_PAGES_FOR_DEDUP) {
    return new Set();
  }
  const rows = await sql.unsafe<{ paragraph_hash: string }[]>(
    `SELECT paragraph_hash
       FROM ${PUBLIC_WEB_SCHEMA}.page_paragraph_hashes
      WHERE domain = $1
      GROUP BY paragraph_hash
     HAVING count(DISTINCT url) >= ${BOILERPLATE_PAGE_THRESHOLD}`,
    [domain],
  );
  return new Set(rows.map((row) => row.paragraph_hash));
}

/** Push the corpus-side truth onto every member organization's Convex row —
 * called after every continuation link and at the end of a scan, so the UI
 * follows the crawl instead of waiting for its next poll. */
async function fanOutRowSync(
  ctx: ActionCtx,
  sql: Sql,
  domain: string,
): Promise<void> {
  try {
    const members = await sql.unsafe<{ org_slug: string }[]>(
      `SELECT org_slug FROM ${PUBLIC_WEB_SCHEMA}.website_org_memberships
        WHERE domain = $1`,
      [domain],
    );
    for (const member of members) {
      await ctx.scheduler.runAfter(
        0,
        internal.websites.internal_actions.syncWebsiteRowForDomain,
        { orgSlug: member.org_slug, domain },
      );
    }
  } catch (error) {
    console.warn(
      `[crawl] ${domain}: row sync fan-out failed:`,
      error instanceof Error ? error.message : error,
    );
  }
}

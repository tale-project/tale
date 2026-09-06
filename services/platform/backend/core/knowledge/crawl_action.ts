'use node';

/**
 * The website crawl engine: discover a domain's pages (or take an operator's
 * URL list verbatim), fetch them politely, strip cross-page boilerplate, and
 * index the text into the `public_web` corpus — chunks (embedded with the
 * organization's model when one is configured) plus the full page text
 * `rag_fetch` serves back.
 *
 * Every fetch dispatches on the response content type, never a heuristic:
 * documents (pdf/docx/xlsx/pptx/odt) and plain text are extracted
 * in-process; HTML is rendered in batches by a sandboxed browser
 * (`renderUrlsInSandbox`) so JS-rendered sites yield their real content.
 * The in-process probe stays the authority on page lifecycle — status
 * codes, deletes, size caps, SSRF guards — and content-hash comparison is
 * the only change detection.
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
 *
 * When that database itself cannot be reached (a rotated credential, DNS, a
 * refused connection), the failure is recorded on the Convex `websites` row —
 * the only store still standing — instead of the corpus. Failed scans back
 * off to a bounded retry window, and repeated connection failures pause the
 * site's scans and notify the organization's admins; the policy lives in
 * `websites/scan_scheduling.ts`.
 */

import { computeContentHash } from '@tale/shared/utils/hashing';
import type { Sql } from 'postgres';

import { chunkDocument } from '../../../lib/knowledge/chunking';
import {
  classifyContentType,
  documentNameForUrl,
  extractLinks,
  isDisallowed,
  isSitemapIndex,
  normalizeCandidateUrl,
  paragraphsForHashing,
  parseRobots,
  parseSitemapLocs,
  siteHosts,
  stripBoilerplate,
} from '../../../lib/knowledge/crawl-parse';
import { htmlTitle, htmlToText } from '../../../lib/knowledge/html-to-text';
import { PUBLIC_WEB_SCHEMA } from '../../../lib/knowledge/types';
import {
  safeFetch,
  safeFetchBinary,
  SafeFetchError,
} from '../../../lib/net/safe-fetch';
import type { ActionCtx } from '../lib/ctx';
import { internal } from '../lib/handler_names';
import { orgSlugFromIdOrNull } from '../lib/helpers/org_slug';
import { extractText } from '../lib/knowledge/extraction/router';
import { renderUrlsInSandbox } from '../node_only/sandbox/render_fetch';
import {
  isDueForScan,
  WEBSITE_NOT_IN_CORPUS_MESSAGE,
} from '../websites/scan_scheduling';
import { readOrgEmbeddingConfig } from './connection';
import { MAX_URLS_PER_DOMAIN, admitUrls, reviveListedUrls } from './crawl';
import { pinDimensions } from './dimensions';
import { Embedder, embedderForOrg, EmbeddingNotConfigured } from './embedding';
import { assertCorpusWritable } from './index_health';
import {
  getKnowledgePoolForOrg,
  isConnectionFailure,
  resolveOrgUrl,
} from './pool';

/** One continuation link crawls at most this long before rescheduling —
 * far under the ~10-minute point where the runtime kills a node action
 * without running its catch. */
const SCAN_BUDGET_MS = 300_000;
/** Pause between page fetches; a crawler that hammers a site gets blocked,
 * and these actions share the backend process with everything else. */
const FETCH_DELAY_MS = 500;
/** Pause before the next continuation link. */
const CONTINUATION_DELAY_MS = 5_000;
/** Chain-length backstop against a chain that stops making progress. Sized
 * so the URL cap, not this, is the binding limit for ordinary sites; a scan
 * it does cut off finishes early and the next interval resumes the frontier
 * (rows keep `last_crawled_at`, so nothing is refetched needlessly). */
const MAX_CONTINUATIONS = 200;

const PAGE_TIMEOUT_MS = 15_000;
const PAGE_MAX_BYTES = 2 * 1024 * 1024;
const SITEMAP_MAX_BYTES = 8 * 1024 * 1024;
const ROBOTS_MAX_BYTES = 256 * 1024;

/** Content fetch budgets. Documents run far fatter and slower than HTML
 * pages (a consolidated legal handbook PDF is megabytes), so the page fetch
 * gets its own timeout and cap. */
const PAGE_FETCH_TIMEOUT_MS = 30_000;
const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;

/** Render lane budgets. HTML pages are rendered in a sandboxed browser in
 * batches; the node action's hard kill sits near ten minutes, so a link
 * stops opening render sessions once its remaining window could no longer
 * fit a session create + exec + harvest. */
const ACTION_HARD_WALL_MS = 540_000;
const RENDER_BATCH_SIZE = 10;
const RENDER_MIN_WINDOW_MS = 120_000;
const RENDER_EXEC_MAX_MS = 240_000;
const RENDER_HARVEST_MARGIN_MS = 30_000;

/** Sitemap fetches per discovery (indexes recurse one level). Sites chunk
 * their sitemaps — per month, per section — so filling the URL cap can take
 * dozens of documents. */
const MAX_SITEMAP_FETCHES = 50;
/** When sitemaps yield fewer URLs than this, fall back to link-walking. */
const BFS_FALLBACK_THRESHOLD = 10;
const BFS_MAX_DEPTH = 2;
const BFS_FETCH_BUDGET = 30;
/** Discovery shares link 0's action with a fetch window; this keeps a site
 * with many slow sitemaps (or a slow link-walk) from riding the whole
 * action into the runtime's ~10-minute hard kill. */
const DISCOVERY_BUDGET_MS = 180_000;

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

/** The engine body, hoisted so the 0.5 backend can run it on a ctx shim
 * (the wrapper above keeps the 0.4 wiring). */
export async function scanWebsiteImpl(
  ctx: ActionCtx,
  args: {
    domain: string;
    orgSlug: string;
    organizationId: string;
    continuation?: number;
    scanStartedAt?: string;
  },
): Promise<null> {
  {
    const actionStartedAt = Date.now();
    const continuation = args.continuation ?? 0;
    const scanStartedAt = args.scanStartedAt ?? new Date().toISOString();
    const identity: ScanIdentity = {
      domain: args.domain,
      orgSlug: args.orgSlug,
      organizationId: args.organizationId,
    };

    // Acquiring the pool runs real SQL on a bring-your-own database (the
    // corpus-schema bootstrap), so a rotated credential or an unreachable
    // host throws right here. Uncaught, this was TALE-PROJECT-106: the error
    // escaped the action, nothing was recorded anywhere, and the scheduler
    // re-queued the domain forever.
    let sql: Sql;
    try {
      sql = await getKnowledgePoolForOrg(args.orgSlug);
    } catch (error) {
      await recordFailureOnWebsiteRow(ctx, identity, error, {
        corpusUnreachable: true,
      });
      return null;
    }

    try {
      const kind = await domainKind(sql, args.domain);
      if (continuation === 0) {
        const claim = await claimScan(sql, args.domain);
        if (claim === 'held') {
          console.log(`[crawl] ${args.domain}: scan already running, skipping`);
          return null;
        }
        if (claim === 'missing') {
          // No corpus row to claim (registration never landed, or was
          // released): without a recorded attempt the scheduler re-picks
          // the domain every tick and nothing ever shows the user why.
          await recordFailureOnWebsiteRow(
            ctx,
            identity,
            new Error(WEBSITE_NOT_IN_CORPUS_MESSAGE),
            { corpusUnreachable: false },
          );
          return null;
        }
        // Surface the claim right away — discovery can run minutes and the
        // next sync is at the link's end, so without this a rescan sits on
        // a stale Active/Idle row the whole first link.
        await fanOutRowSync(ctx, sql, args.domain);
        // Listed URLs are a standing instruction: one a past scan marked
        // `deleted` (404 then) goes back on the frontier every scan, so a
        // page that is back is re-indexed instead of staying dark for good.
        const revived = await reviveListedUrls(sql, args.domain);
        if (revived > 0) {
          console.log(
            `[crawl] ${args.domain}: ${revived} listed URL(s) revived for re-probe`,
          );
        }
        // A URL list has no discovery: its operator-listed rows ARE the
        // frontier, and robots.txt does not govern explicitly requested
        // pages (the same stance web_fetch takes).
        if (kind === 'site') {
          await discoverAndRecordUrls(
            sql,
            args.domain,
            actionStartedAt + DISCOVERY_BUDGET_MS,
          );
        }
      }

      // Fetch AND index page by page inside the budget window; HTML pages
      // queue for a sandboxed render batch and settle when it flushes. A
      // page is indexed the moment it changes — a killed action loses at
      // most one batch's work, and rows a flush never settled stay due for
      // the next link (unchanged text with no chunks counts as changed).
      // The hard wall is measured from the ACTION's start — on link 0,
      // discovery has already spent part of the window, and the fetch loop
      // must not ride what remains past the runtime's kill point.
      const linkStartedAt = Date.now();
      const hardWall = actionStartedAt + ACTION_HARD_WALL_MS;
      const deadline = Math.min(linkStartedAt + SCAN_BUDGET_MS, hardWall);
      const indexer = new PageIndexer(ctx, sql, identity);
      const renderQueue: DuePage[] = [];
      let renderBatchCounter = 0;

      const flushRenderBatch = async (): Promise<void> => {
        if (renderQueue.length === 0) return;
        const window = hardWall - Date.now();
        if (window < RENDER_MIN_WINDOW_MS) {
          // Too close to the action's kill point to open a session — drop
          // the queue UNMARKED so the next continuation link retries it.
          renderQueue.length = 0;
          return;
        }
        const batch = renderQueue.splice(0);
        renderBatchCounter += 1;
        // Infra failures (quota, session create, transport) THROW into the
        // scan's error path: rows stay untouched, the status is visible,
        // and the next interval retries. Only per-URL render outcomes are
        // charged to the page's fail_count.
        const results = await renderUrlsInSandbox(ctx, {
          organizationId: args.organizationId,
          urls: batch.map((page) => page.url),
          batchKey: `${args.domain}:${scanStartedAt}:${continuation}:${renderBatchCounter}`,
          execTimeoutMs: Math.min(
            RENDER_EXEC_MAX_MS,
            window - RENDER_HARVEST_MARGIN_MS,
          ),
        });
        for (const page of batch) {
          const outcome = results.get(page.url) ?? {
            kind: 'not_attempted' as const,
          };
          if (outcome.kind === 'not_attempted') continue;
          if (outcome.kind === 'failed') {
            console.warn(
              `[crawl] ${page.url}: render failed: ${outcome.reason}`,
            );
            await recordPageFailure(sql, args.domain, page.url);
            continue;
          }
          const stored = await storePageText(
            sql,
            args.domain,
            page,
            htmlTitle(outcome.html),
            htmlToText(outcome.html),
          );
          if (stored === 'changed') await indexer.indexPage(page.url);
          if (kind === 'site') {
            await admitRenderedLinks(
              sql,
              args.domain,
              outcome.html,
              outcome.finalUrl,
            );
          }
        }
      };

      while (Date.now() < deadline) {
        const pages = await nextDuePages(
          sql,
          args.domain,
          scanStartedAt,
          RENDER_BATCH_SIZE,
        );
        if (pages.length === 0) break;
        for (const page of pages) {
          if (Date.now() >= deadline) break;
          const outcome = await fetchAndStorePage(sql, args.domain, page);
          if (outcome === 'render') renderQueue.push(page);
          else if (outcome === 'changed') await indexer.indexPage(page.url);
          await sleep(FETCH_DELAY_MS);
          if (renderQueue.length >= RENDER_BATCH_SIZE) await flushRenderBatch();
        }
        // Settle the partial batch BEFORE re-querying the frontier — the
        // queued rows are unmarked and would come straight back.
        await flushRenderBatch();
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
      // The scan completed, so the site leaves the failure-retry cadence and
      // returns to its own interval. Best-effort: a hiccup here must not
      // flip a finished scan into the error path.
      await ctx
        .runMutation(internal.websites.internal_mutations.clearScanFailures, {
          organizationId: args.organizationId,
          domain: args.domain,
        })
        .catch((clearError: unknown) => {
          console.warn(
            `[crawl] ${args.domain}: could not clear the failure bookkeeping:`,
            clearError instanceof Error ? clearError.message : clearError,
          );
        });
    } catch (error) {
      if (isConnectionFailure(error)) {
        // The corpus database dropped away mid-scan. Recording the failure
        // into it would fail with it, and the row-sync fan-out below reads
        // it — the Convex row is the only store still standing, so record
        // there and stop.
        await recordFailureOnWebsiteRow(ctx, identity, error, {
          corpusUnreachable: true,
        });
        return null;
      }
      const message = error instanceof Error ? error.message : String(error);
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
      // Stamp the attempt on the Convex row too: it advances the scheduler's
      // clock (the backoff), where the corpus-side marker alone left the
      // domain due again on the very next five-minute tick.
      await recordFailureOnWebsiteRow(ctx, identity, error, {
        corpusUnreachable: false,
      });
    }

    await fanOutRowSync(ctx, sql, args.domain);
    return null;
  }
}

/** The scheduler body, hoisted for the 0.5 backend (see scanWebsiteImpl). */
export async function scanDueWebsitesImpl(ctx: ActionCtx): Promise<null> {
  {
    const websites = await ctx.runQuery(
      internal.websites.internal_queries.listWebsitesForScanScheduling,
      {},
    );
    const now = Date.now();
    // The policy (intervals, stuck-scan takeover, failure backoff, pause) is
    // the pure `isDueForScan` in websites/scan_scheduling.ts.
    const due = websites.filter((site: Parameters<typeof isDueForScan>[0]) =>
      isDueForScan(site, now),
    );

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
  }
}

/** What this domain row is: a crawled site (pages discovered) or a curated
 * URL list (exactly the listed rows are fetched). Rows that predate the
 * distinction read as 'site'. */
async function domainKind(sql: Sql, domain: string): Promise<'site' | 'list'> {
  const rows = await sql.unsafe<{ kind: string }[]>(
    `SELECT kind FROM ${PUBLIC_WEB_SCHEMA}.websites WHERE domain = $1`,
    [domain],
  );
  return rows[0]?.kind === 'list' ? 'list' : 'site';
}

/** Take the corpus-side claim on a domain (`claimed`), or report that
 * another scan holds it (`held`) or that the domain has no corpus row at all
 * (`missing` — the two zero-row cases must not be conflated: a held claim is
 * routine, a missing row is a failure to record). A claim older than
 * {@link STUCK_SCAN_TAKEOVER} belongs to a crashed scan and is taken over. */
async function claimScan(
  sql: Sql,
  domain: string,
): Promise<'claimed' | 'held' | 'missing'> {
  const rows = await sql.unsafe<{ domain: string }[]>(
    `UPDATE ${PUBLIC_WEB_SCHEMA}.websites
        SET status = 'scanning', error = NULL, updated_at = NOW()
      WHERE domain = $1
        AND (status NOT IN ('scanning', 'deleting')
             OR (status = 'scanning' AND updated_at < NOW() - INTERVAL '${STUCK_SCAN_TAKEOVER}'))
      RETURNING domain`,
    [domain],
  );
  if (rows.length > 0) return 'claimed';
  const present = await sql.unsafe<{ domain: string }[]>(
    `SELECT domain FROM ${PUBLIC_WEB_SCHEMA}.websites WHERE domain = $1`,
    [domain],
  );
  return present.length > 0 ? 'held' : 'missing';
}

/** Discover the domain's URLs (robots.txt sitemaps first, link-walk as the
 * fallback) and record them as `discovered` rows for the fetch loop.
 * `deadline` bounds the fetching: a discovery cut short records what it
 * has — the next scan's discovery pass tops the frontier up. */
async function discoverAndRecordUrls(
  sql: Sql,
  domain: string,
  deadline: number,
): Promise<void> {
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
  while (
    sitemapQueue.length > 0 &&
    sitemapFetches < MAX_SITEMAP_FETCHES &&
    Date.now() < deadline
  ) {
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
      if (response.status < 200 || response.status >= 300) {
        console.warn(
          `[crawl] ${domain}: sitemap ${next.url} answered ${response.status}; skipping it`,
        );
        continue;
      }
      xml = response.body;
    } catch (error) {
      // A sitemap that times out, exceeds the size cap or is refused by the
      // host allowlist silently degraded a large site to the link walk;
      // the triage question is always WHICH of those it was.
      console.warn(
        `[crawl] ${domain}: sitemap fetch failed for ${next.url}: ${error instanceof Error ? error.message : String(error)}`,
      );
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
    while (
      queue.length > 0 &&
      fetches < BFS_FETCH_BUDGET &&
      Date.now() < deadline
    ) {
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
      } catch (error) {
        console.warn(
          `[crawl] ${domain}: link-walk fetch failed for ${next.url}: ${error instanceof Error ? error.message : String(error)}`,
        );
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

  // The shared admission door: new rows start `discovered`, and a row a past
  // scan marked `deleted` is revived — the site links to the page again, so
  // the fetch (not the memory of a 404) decides whether it is back.
  await admitUrls(sql, domain, [...urls], { listed: false });
  console.log(`[crawl] ${domain}: ${urls.size} URLs discovered`);
}

interface DuePage {
  readonly url: string;
  readonly content_hash: string | null;
}

const DUE_PAGE_PREDICATE = `
      domain = $1 AND status <> 'deleted' AND fail_count < ${MAX_FETCH_FAILURES}
      AND (last_crawled_at IS NULL OR last_crawled_at < $2::timestamptz)`;

/** The next URLs this scan has not visited yet (never-crawled first). The
 * batch size matches the render batch, so one claim's HTML pages fill at
 * most one render session. */
async function nextDuePages(
  sql: Sql,
  domain: string,
  scanStartedAt: string,
  limit: number,
): Promise<DuePage[]> {
  return await sql.unsafe<DuePage[]>(
    `SELECT url, content_hash
       FROM ${PUBLIC_WEB_SCHEMA}.website_urls
      WHERE ${DUE_PAGE_PREDICATE}
      ORDER BY last_crawled_at ASC NULLS FIRST, url ASC
      LIMIT $3`,
    [domain, scanStartedAt, limit],
  );
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

type FetchOutcome = 'changed' | 'unchanged' | 'failed' | 'render';

/**
 * Probe one page and dispatch on its content type: binaries and plain text
 * are extracted and stored in-process; HTML reports `render` (body
 * discarded, row left unmarked) so the caller batches it through the
 * sandboxed browser. The probe is the sole authority on page LIFECYCLE —
 * status codes, deletes, size caps, and the SSRF guard for every byte
 * download. Change detection is the stored content hash alone: a 304 on an
 * SPA shell proves nothing about rendered content, so no conditional
 * validators are sent.
 */
async function fetchAndStorePage(
  sql: Sql,
  domain: string,
  page: DuePage,
): Promise<FetchOutcome> {
  const hosts = siteHosts(domain);

  let response;
  try {
    response = await safeFetchBinary(page.url, {
      timeoutMs: PAGE_FETCH_TIMEOUT_MS,
      maxResponseBytes: DOCUMENT_MAX_BYTES,
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
  const dispatch = classifyContentType(contentType);
  if (dispatch.kind === 'skip') {
    // Not something this lane can turn into text (an image, a feed, a
    // binary download) — remember we looked so the scan moves on, but
    // store nothing.
    await markPageVisited(sql, domain, page.url);
    return 'unchanged';
  }
  if (dispatch.kind === 'html') {
    // Content comes from the rendered DOM, not this probe body — the page
    // joins the render batch and its row stays unmarked until the batch
    // settles it.
    return 'render';
  }
  const bytes = new Uint8Array(await response.body.arrayBuffer());

  let title: string | null;
  let text: string;
  if (dispatch.kind === 'text') {
    title = null;
    text = new TextDecoder().decode(bytes);
  } else {
    const name = documentNameForUrl(page.url, dispatch.extension);
    try {
      // The crawl lane carries no vision arm; extractors degrade on their
      // own (scanned PDF pages come back empty instead of failing).
      const [extracted] = await extractText(bytes, name, {
        visionClient: null,
        processImages: false,
      });
      text = extracted;
    } catch (error) {
      console.warn(
        `[crawl] ${page.url}: extraction failed for ${name}:`,
        error instanceof Error ? error.message : error,
      );
      await markPageVisited(sql, domain, page.url);
      return 'unchanged';
    }
    title = name;
  }
  return await storePageText(sql, domain, page, title, text);
}

/**
 * Store one page's extracted text, title, and paragraph hashes; report
 * whether the content changed. Only changed pages are re-chunked and
 * re-embedded — and a page whose text is unchanged but whose chunks are
 * missing (an earlier scan died between fetch and index) counts as changed.
 */
async function storePageText(
  sql: Sql,
  domain: string,
  page: DuePage,
  title: string | null,
  text: string,
): Promise<'changed' | 'unchanged'> {
  const contentHash = computeContentHash(text);
  const wordCount = text.split(/\s+/).filter((word) => word.length > 0).length;

  const unchanged = page.content_hash === contentHash;
  await sql.begin(async (tx) => {
    await tx.unsafe(
      `UPDATE ${PUBLIC_WEB_SCHEMA}.website_urls
          SET content = $3, title = $4, content_hash = $5, word_count = $6,
              status = 'active', last_crawled_at = NOW(), fail_count = 0
        WHERE domain = $1 AND url = $2`,
      [domain, page.url, text, title, contentHash, wordCount],
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
    const chunkRows = await sql.unsafe<{ ok: number }[]>(
      `SELECT 1 AS ok FROM ${PUBLIC_WEB_SCHEMA}.chunks
        WHERE domain = $1 AND url = $2 LIMIT 1`,
      [domain, page.url],
    );
    return chunkRows.length > 0 ? 'unchanged' : 'changed';
  }
  return 'changed';
}

/**
 * Admit same-site links found in a rendered page (site kind only) so SPA
 * sites — whose anchors exist only after JS runs — still grow the frontier.
 * Honours the host and asset-suffix rules and the per-domain cap; robots
 * disallow rules apply at discovery time only (accepted residue until a
 * robots-sensitive JS site matters). Freshly admitted rows have no
 * `last_crawled_at`, so the running scan picks them up.
 */
async function admitRenderedLinks(
  sql: Sql,
  domain: string,
  html: string,
  baseUrl: string,
): Promise<void> {
  const hosts = siteHosts(domain);
  const countRows = await sql.unsafe<{ n: string }[]>(
    `SELECT count(*)::text AS n FROM ${PUBLIC_WEB_SCHEMA}.website_urls
      WHERE domain = $1 AND status <> 'deleted'`,
    [domain],
  );
  let tracked = Number(countRows[0]?.n ?? 0);
  for (const href of extractLinks(html)) {
    if (tracked >= MAX_URLS_PER_DOMAIN) {
      console.warn(
        `[crawl] ${domain}: URL cap of ${MAX_URLS_PER_DOMAIN} reached during rendered-link admission`,
      );
      return;
    }
    const normalized = normalizeCandidateUrl(href, baseUrl, hosts);
    if (!normalized) continue;
    // Inserted or revived rows are newly tracked (`deleted` rows are not in
    // the count above); unchanged live rows report zero.
    tracked += await admitUrls(sql, domain, [normalized], { listed: false });
  }
}

/** Remember that the scan looked at a URL without storing content for it. */
async function markPageVisited(
  sql: Sql,
  domain: string,
  url: string,
): Promise<void> {
  await sql.unsafe(
    `UPDATE ${PUBLIC_WEB_SCHEMA}.website_urls
        SET last_crawled_at = NOW(), fail_count = 0
      WHERE domain = $1 AND url = $2`,
    [domain, url],
  );
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
    // A corpus whose BM25 index is being rebuilt refuses the write with a
    // coded error — recorded on the website row by the scan's error path —
    // instead of PANICking the database; the next scheduled scan retries.
    await assertCorpusWritable(
      await resolveOrgUrl(this.identity.orgSlug),
      PUBLIC_WEB_SCHEMA,
    );
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

/**
 * Record a failed scan attempt on the organization's Convex `websites` row —
 * for connection-class failures the ONLY reachable store — and log the pause
 * transition when the failure streak crosses the threshold. Never throws: a
 * failure to record must not mask the scan failure being recorded.
 */
async function recordFailureOnWebsiteRow(
  ctx: ActionCtx,
  identity: ScanIdentity,
  error: unknown,
  options: { corpusUnreachable: boolean },
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    `[crawl] ${identity.domain}: scan failed${
      options.corpusUnreachable ? ' (knowledge database unreachable)' : ''
    }:`,
    message,
  );
  try {
    const { paused } = await ctx.runMutation(
      internal.websites.internal_mutations.recordScanFailure,
      {
        organizationId: identity.organizationId,
        domain: identity.domain,
        message,
        corpusUnreachable: options.corpusUnreachable,
      },
    );
    if (paused) {
      console.warn(
        `[crawl] ${identity.domain}: scans paused after repeated connection failures; org admins notified`,
      );
    }
  } catch (recordError) {
    console.error(
      `[crawl] ${identity.domain}: could not record the failure on the websites row:`,
      recordError instanceof Error ? recordError.message : recordError,
    );
  }
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

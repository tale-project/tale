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
import type { JSONValue, Sql, TransactionSql } from 'postgres';

import { chunkDocument } from '../../../lib/knowledge/chunking';
import {
  classifyContentType,
  classifyRenderReason,
  discoverableLinks,
  documentNameForUrl,
  EMPTY_ROBOTS_POLICY,
  isSitemapIndex,
  isUrlDisallowed,
  normalizeCandidateUrl,
  paragraphsForHashing,
  parseRobots,
  parseSitemapLocs,
  publicPageError,
  renderLaneHaltMessage,
  ROBOTS_TXT_MAX_BYTES,
  type RobotsPolicy,
  type RobotsRules,
  robotsHeaderForbidsIndexing,
  robotsMetaNoindexDirective,
  robotsPolicyFromStored,
  robotsPolicyToStored,
  siteHosts,
  stripBoilerplate,
  robotsSitemapsFromStored,
} from '../../../lib/knowledge/crawl-parse';
import { htmlTitle, htmlToText } from '../../../lib/knowledge/html-to-text';
import { PUBLIC_WEB_SCHEMA } from '../../../lib/knowledge/types';
import {
  crawlHostRefusal,
  privateCrawlHostsAllowed,
} from '../../../lib/net/crawl-host-policy';
import {
  safeFetch,
  safeFetchBinary,
  SafeFetchError,
} from '../../../lib/net/safe-fetch';
import { sanitizeError } from '../lib/utils/sanitize_secrets';

/**
 * Refuse to dial a URL the crawl-target policy would never have let in.
 * The domain was checked at registration, but a row registered before the
 * policy — or a link on a crawled page — must not reach `safeFetch` with
 * the site's own hosts as `allowedHosts`, the exact switch that suspends
 * its private-range refusal. Thrown as the fetch error the callers already
 * classify, so a refused target is logged and skipped like a dead one.
 */
function assertCrawlableUrl(url: string): void {
  const refusal = crawlHostRefusal(new URL(url).hostname);
  if (refusal !== null) {
    throw new SafeFetchError('private_ip', `Crawl target refused: ${refusal}`);
  }
}
import type { ActionCtx } from '../lib/ctx';
import { internal } from '../lib/handler_names';
import { orgSlugFromIdOrNull } from '../lib/helpers/org_slug';
import { extractText } from '../lib/knowledge/extraction/router';
import { sniffDocumentExtension } from '../lib/knowledge/extraction/sniff';
import {
  RenderCapacityError,
  renderCapacityPollMs,
  renderUrlsInSandbox,
} from '../node_only/sandbox/render_fetch';
import { runFailureMessage } from '../provider_credentials/resolve_credential';
import {
  isDueForScan,
  WEBSITE_NOT_IN_CORPUS_MESSAGE,
  websiteEmbeddingFailureReason,
} from '../websites/scan_scheduling';
import { type PageFailureKind, PAGE_SKIP_KINDS_SQL } from '../websites/types';
import { readOrgEmbeddingConfig } from './connection';
import { MAX_URLS_PER_DOMAIN, admitUrls, reviveListedUrls } from './crawl';
import { crawlDocumentMaxBytes } from './crawl_limits';
import {
  CRAWLER_PRODUCT_TOKEN,
  crawlerRequestHeaders,
} from './crawler_identity';
import { EmbeddingDimensionMismatch, pinDimensions } from './dimensions';
import {
  classifyEmbeddingFailure,
  Embedder,
  embedderForOrg,
  EmbeddingNotConfigured,
} from './embedding';
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
 * and these actions share the backend process with everything else. A
 * site's own `Crawl-delay` lengthens it (never shortens it). */
const FETCH_DELAY_MS = 500;
/** The pause between two fetches from one site: the floor above, or the
 * `Crawl-delay` its robots.txt asks of this crawler (2026-09-18
 * evaluation, J6-8). */
function fetchDelayMs(policy: RobotsPolicy): number {
  return Math.max(FETCH_DELAY_MS, policy.crawlDelayMs);
}
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

/** Content fetch budgets. Documents run far fatter and slower than HTML
 * pages (a consolidated legal handbook PDF is megabytes, a brochure tens),
 * so the page fetch gets its own timeout and cap — the cap the operator's
 * `KNOWLEDGE_CRAWL_DOCUMENT_MAX_BYTES`, read once at boot. */
const PAGE_FETCH_TIMEOUT_MS = 30_000;
const DOCUMENT_MAX_BYTES = crawlDocumentMaxBytes();

/** Render lane budgets. HTML pages are rendered in a sandboxed browser in
 * batches; the node action's hard kill sits near ten minutes, so a link
 * stops opening render sessions once its remaining window could no longer
 * fit a session create + exec + harvest. */
const ACTION_HARD_WALL_MS = 540_000;
const RENDER_BATCH_SIZE = 10;
const RENDER_MIN_WINDOW_MS = 120_000;
const RENDER_EXEC_MAX_MS = 240_000;
const RENDER_HARVEST_MARGIN_MS = 30_000;
/** The organization's render sessions are a shared budget (two by default),
 * and a third concurrent scan finds it spent. That is a wait, not a failed
 * scan: the link polls for a slot this often while its window allows, and
 * when none comes it leaves the batch for the next link, which follows
 * after the longer pause (2026-09-18 evaluation, J6-3). The scan used to
 * end in `error` with everything it had fetched discarded. */
const RENDER_CAPACITY_POLL_MS = 15_000;
const RENDER_CAPACITY_RETRY_MS = 60_000;

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

/** A DISCOVERED URL that failed this many scans in a row stops being
 * fetched — for {@link BENCHED_PAGE_RETRY_INTERVAL}, after which one scan
 * probes it once more (a further failure benches it again for as long). A
 * LISTED one never stops — the operator asked for it by name, so it is
 * probed once per scan for as long as it is listed (the scan interval is
 * the backoff, `last_crawled_at < scanStartedAt` the bound), and its
 * `fail_count` keeps counting so the page list can say for how long it has
 * been failing. Before this a listed page that failed five scans was dead
 * for good, and re-listing it changed nothing; and a discovered page was
 * dead for good too — five scans with the render sandbox's proxy refusing
 * every tunnel benched a whole site, and fixing the proxy revived nothing
 * (2026-09-30). The lane's own faults are no longer charged at all
 * (`flushRenderBatch`), and the bench now expires. */
const MAX_FETCH_FAILURES = 5;
/** How long a benched page waits for its one further probe — a Postgres
 * interval. A week bounds the cost of a dead URL to one request a week and
 * still lets a page revived on the site come back on its own. */
const BENCHED_PAGE_RETRY_INTERVAL = '7 days';

/** Pages the vector backfill reads per query (`PageIndexer.embedVectorless`). */
const EMBED_BATCH_PAGES = 20;

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
    /** The heartbeat of a claim whose scan is known to have stopped: the
     * scheduler found the row scanning with no scan job left for it. Link 0
     * takes exactly that claim over instead of waiting out
     * {@link STUCK_SCAN_TAKEOVER}; a claim that moved since is left alone. */
    takeover?: string;
    /** Aborted once the job this link runs in has ended under it — the
     * process is stopping, or the link outlived the job's expiry. */
    signal?: AbortSignal;
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
      const facts = await domainFacts(sql, args.domain);
      const kind = facts.kind;
      // The robots rules every non-listed admission and fetch of this link
      // judges by: read fresh on link 0, from the row on every later link.
      let policy: RobotsPolicy = facts.policy;
      if (continuation > 0) {
        // The link's sign of life on the claim, as link 0's claim is: a
        // claim is taken over only once it is older than a link can hold it
        // (`LINK_LIFETIME_MS`), and a continuation may have waited in the
        // queue for long after the link before it refreshed it.
        await sql.unsafe(
          `UPDATE ${PUBLIC_WEB_SCHEMA}.websites SET updated_at = NOW()
            WHERE domain = $1 AND status = 'scanning'`,
          [args.domain],
        );
      }
      if (continuation === 0) {
        const claim = await claimScan(sql, args.domain, args.takeover);
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
          const robots = await loadRobotsRules(sql, args.domain, facts.policy, {
            fetchedAt: facts.robotsFetchedAt,
            sitemaps: facts.sitemaps,
          });
          policy = robots;
          await discoverAndRecordUrls(
            sql,
            args.domain,
            actionStartedAt + DISCOVERY_BUDGET_MS,
            robots,
            scanStartedAt,
          );
          const retired = await retireDisallowedRows(sql, args.domain, policy);
          if (retired > 0) {
            console.log(
              `[crawl] ${args.domain}: ${retired} page(s) retired — robots.txt disallows them`,
            );
          }
          // The frontier is known: stamp the row now, so the page counts
          // move within the discovery budget instead of at the first
          // link's end (2026-09-14 evaluation, h5).
          await fanOutRowSync(ctx, sql, args.domain);
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
      // Set once the organization's render sessions stayed spent for the
      // rest of this link's window: the link stops fetching (every HTML
      // page it probed would only queue behind the same wait) and hands the
      // frontier to the next link after the longer pause.
      let renderDeferred = false;

      /** The batch's render results, or null when the render capacity
       * stayed spent for the rest of the window (the batch is left unmarked
       * for the next link). Infra failures other than capacity — session
       * create, transport, a missing output file — THROW into the scan's
       * error path: rows stay untouched, the status is visible, and the next
       * interval retries. */
      const renderBatch = async (
        batch: readonly DuePage[],
      ): Promise<Awaited<ReturnType<typeof renderUrlsInSandbox>> | null> => {
        for (;;) {
          const window = hardWall - Date.now();
          if (window < RENDER_MIN_WINDOW_MS) return null;
          try {
            return await renderUrlsInSandbox(ctx, {
              organizationId: args.organizationId,
              urls: batch.map((page) => page.url),
              batchKey: `${args.domain}:${scanStartedAt}:${continuation}:${renderBatchCounter}`,
              execTimeoutMs: Math.min(
                RENDER_EXEC_MAX_MS,
                window - RENDER_HARVEST_MARGIN_MS,
              ),
              crawlDelayMs: policy.crawlDelayMs,
            });
          } catch (error) {
            if (!(error instanceof RenderCapacityError)) throw error;
            const pollMs = renderCapacityPollMs(error, RENDER_CAPACITY_POLL_MS);
            if (window < RENDER_MIN_WINDOW_MS + pollMs) {
              return null;
            }
            console.log(
              `[crawl] ${args.domain}: render capacity is spent (${error.message}); retrying in ${Math.round(pollMs / 1000)} s`,
            );
            await sleep(pollMs);
          }
        }
      };

      const flushRenderBatch = async (): Promise<void> => {
        if (renderQueue.length === 0) return;
        if (hardWall - Date.now() < RENDER_MIN_WINDOW_MS || renderDeferred) {
          // Too close to the action's kill point to open a session, or the
          // capacity wait already gave up — drop the queue UNMARKED so the
          // next continuation link retries it.
          renderQueue.length = 0;
          return;
        }
        const batch = renderQueue.splice(0);
        renderBatchCounter += 1;
        const results = await renderBatch(batch);
        if (results === null) {
          // The batch's rows are unmarked and stay due; the next link
          // renders them once a session is free.
          renderDeferred = true;
          console.log(
            `[crawl] ${args.domain}: no render session came free within this link; ${batch.length} page(s) wait for the next link`,
          );
          return;
        }
        // Only per-URL render outcomes are charged to the page's fail_count.
        // A navigation the browser lost twice is the row's to show, without
        // a strike; the lane's own fault (`halted`) fails the scan below,
        // once what rendered is stored.
        for (const page of batch) {
          const outcome = results.outcomes.get(page.url) ?? {
            kind: 'not_attempted' as const,
          };
          if (outcome.kind === 'not_attempted') continue;
          if (outcome.kind === 'failed') {
            console.warn(
              `[crawl] ${page.url}: render failed${outcome.transient ? ' (browser fault, uncharged)' : ''}: ${outcome.reason}`,
            );
            await recordPageFailure(
              sql,
              args.domain,
              page.url,
              classifyRenderReason(outcome.reason),
              { charge: !outcome.transient },
            );
            continue;
          }
          // The origin's wish in the HTML form: a `<meta name="robots">`
          // that says noindex stores nothing and drops what an earlier
          // scan stored — the header form was honoured, the tag most
          // sites use was not (2026-09-14 evaluation, h5).
          const noindex = robotsMetaNoindexDirective(outcome.html);
          if (noindex !== null) {
            await purgePageContent(sql, args.domain, page.url);
            await recordPageFailure(sql, args.domain, page.url, {
              kind: 'robots_noindex',
              message: `The origin asked not to index this page (<meta name="robots" content="${noindex}">)`,
            });
            continue;
          }
          const stored = await storePageText(
            sql,
            args.domain,
            page,
            htmlTitle(outcome.html),
            htmlToText(outcome.html),
          );
          await indexer.settle(page.url, stored);
          await markPageCrawled(sql, args.domain, page.url);
          if (kind === 'site') {
            await admitRenderedLinks(
              sql,
              args.domain,
              outcome.html,
              outcome.finalUrl,
              policy,
              scanStartedAt,
            );
          }
        }
        if (results.halted) {
          // The lane, not a page: what rendered is stored and indexed, the
          // rest stays due, and the scan ends with the reason on the site's
          // row — the next interval retries every page, none charged.
          throw new Error(renderLaneHaltMessage(results.halted, args.domain));
        }
      };

      // `renderDeferred` is set inside `flushRenderBatch`, which this loop
      // calls — the static check cannot see the closure write.
      // oxlint-disable-next-line eslint/no-unmodified-loop-condition
      while (Date.now() < deadline && !renderDeferred) {
        const pages = await nextDuePages(
          sql,
          args.domain,
          scanStartedAt,
          RENDER_BATCH_SIZE,
        );
        if (pages.length === 0) break;
        for (const page of pages) {
          if (Date.now() >= deadline || renderDeferred) break;
          const outcome = await fetchAndStorePage(
            sql,
            args.domain,
            page,
            policy,
            scanStartedAt,
          );
          if (outcome === 'render') renderQueue.push(page);
          else if (outcome !== 'failed') {
            await indexer.settle(page.url, outcome);
            await markPageCrawled(sql, args.domain, page.url);
          }
          await sleep(fetchDelayMs(policy));
          if (renderQueue.length >= RENDER_BATCH_SIZE) await flushRenderBatch();
        }
        // Settle the partial batch BEFORE re-querying the frontier — the
        // queued rows are unmarked and would come straight back.
        await flushRenderBatch();
        // The row follows the scan: one keyed job per stored batch (bursts
        // fold into one run), so the page counts move as pages land instead
        // of at the link's end (2026-09-14 evaluation, h5).
        await fanOutRowSync(ctx, sql, args.domain);
      }
      // What was stored without vectors — by this scan before an admin saved
      // a model, or by an earlier one — is embedded from its stored text
      // once a model can, in the time the link has left; what is left keeps
      // the chain going.
      const unembedded = renderDeferred
        ? 0
        : await indexer.embedVectorless(deadline);
      await indexer.finish();

      const remaining =
        (await countDuePages(sql, args.domain, scanStartedAt)) + unembedded;
      if (remaining > 0 && continuation < MAX_CONTINUATIONS) {
        // Refresh the claim so a long chain is not mistaken for a crash.
        await sql.unsafe(
          `UPDATE ${PUBLIC_WEB_SCHEMA}.websites SET updated_at = NOW() WHERE domain = $1`,
          [args.domain],
        );
        await fanOutRowSync(ctx, sql, args.domain);
        await ctx.scheduler.runAfter(
          // A link that waited on render capacity gives the other scans
          // time to release a session before it asks again.
          renderDeferred ? RENDER_CAPACITY_RETRY_MS : CONTINUATION_DELAY_MS,
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

      // A scan that stored NO page is not "a successful scan": it lands on
      // the documented `error` state with the reason — the site used to
      // read `active` with `crawledPageCount 1, failedPageCount 1` (a
      // domain that does not resolve, an expired certificate), so the
      // obvious health check was wrong (2026-09-14 evaluation, g4-5); and
      // `active` with zero pages when robots.txt disallowed every page, so
      // nothing was ever attempted (2026-09-18 evaluation, J6-5).
      // `last_scanned_at` is stamped either way — the scan did end — and an
      // errored scan takes the failure cadence.
      const [tally] = await sql.unsafe<
        {
          stored: string;
          attempted: string;
          failed: string;
          skipped: string;
          kind: string | null;
        }[]
      >(
        `SELECT
            count(*) FILTER (WHERE u.status = 'active')::text AS stored,
            count(*) FILTER (WHERE u.last_crawled_at IS NOT NULL)::text AS attempted,
            count(*) FILTER (WHERE u.last_error IS NOT NULL
                               AND u.last_error_kind NOT IN (${PAGE_SKIP_KINDS_SQL}))::text AS failed,
            count(*) FILTER (WHERE u.last_error_kind IN (${PAGE_SKIP_KINDS_SQL}))::text AS skipped,
            (SELECT u2.last_error_kind FROM ${PUBLIC_WEB_SCHEMA}.website_urls u2
              WHERE u2.domain = $1 AND u2.status <> 'deleted' AND u2.last_error IS NOT NULL
              GROUP BY u2.last_error_kind ORDER BY count(*) DESC LIMIT 1) AS kind
           FROM ${PUBLIC_WEB_SCHEMA}.website_urls u
          WHERE u.domain = $1 AND u.status <> 'deleted'`,
        [args.domain],
      );
      const stored = Number(tally?.stored ?? '0');
      const skippedPages = Number(tally?.skipped ?? '0');
      const attempted = Number(tally?.attempted ?? '0');
      const failedPages = Number(tally?.failed ?? '0');
      if (stored === 0) {
        const reason = `No page could be stored: ${
          attempted > 0
            ? `${failedPages} of ${attempted} attempted pages failed${skippedPages > 0 ? ` and ${skippedPages} were skipped` : ''}${tally?.kind ? ` (${tally.kind})` : ''}`
            : remaining > 0
              ? `${remaining} page(s) were still waiting when the scan's continuation budget ran out`
              : isUrlDisallowed(`https://${args.domain}/`, policy)
                ? `robots.txt disallows this crawler (User-agent: ${CRAWLER_PRODUCT_TOKEN}, or *) from the homepage, and no other page was admitted`
                : 'discovery found no page to fetch'
        }`;
        await sql.unsafe(
          `UPDATE ${PUBLIC_WEB_SCHEMA}.websites
              SET status = 'error', last_scanned_at = NOW(), error = $2,
                  updated_at = NOW(),
                  page_count = (SELECT count(*) FROM ${PUBLIC_WEB_SCHEMA}.website_urls u
                                 WHERE u.domain = websites.domain AND u.status <> 'deleted')
            WHERE domain = $1`,
          [args.domain, reason.slice(0, 1000)],
        );
        console.warn(
          `[crawl] ${args.domain}: scan finished with nothing stored — ${reason}`,
        );
        await recordFailureOnWebsiteRow(ctx, identity, new Error(reason), {
          corpusUnreachable: false,
        });
      } else {
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
        // The scan completed, so the site leaves the failure-retry cadence
        // and returns to its own interval. Best-effort: a hiccup here must
        // not flip a finished scan into the error path.
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
      }
    } catch (error) {
      if (isConnectionFailure(error)) {
        if (args.signal?.aborted === true) {
          // The job this link ran in has already ended: the process is
          // stopping and has closed its pools under the link. That is not
          // the corpus being unreachable, and recorded as that it would
          // count toward the three failures that pause a site and notify
          // its admins. The scheduler resumes the scan.
          console.warn(
            `[crawl] ${args.domain}: link ${continuation} lost its connection after its job ended; nothing recorded`,
          );
          return null;
        }
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

interface DomainFacts {
  /** A crawled site (pages discovered) or a curated URL list (exactly the
   * listed rows are fetched). Rows that predate the distinction read as
   * 'site'. */
  readonly kind: 'site' | 'list';
  /** The robots policy the last scan persisted — what every continuation
   * link judges by; no rules for a list row (its rows are the operator's
   * instruction) or before the first scan of this release. */
  readonly policy: RobotsPolicy;
  /** When `policy` was read from the site (epoch ms), null when never. */
  readonly robotsFetchedAt: number | null;
  /** The sitemaps that read advertised; null when the row holds a policy
   * from before they were stored — a scan then reads robots.txt again. */
  readonly sitemaps: readonly string[] | null;
}

/** What this domain row is, and the rules it is crawled under. */
async function domainFacts(sql: Sql, domain: string): Promise<DomainFacts> {
  const rows = await sql.unsafe<
    { kind: string; robots_disallow: unknown; robots_fetched_at_ms: unknown }[]
  >(
    `SELECT kind, robots_disallow,
            (EXTRACT(EPOCH FROM robots_fetched_at) * 1000)::float8
              AS robots_fetched_at_ms
       FROM ${PUBLIC_WEB_SCHEMA}.websites
      WHERE domain = $1`,
    [domain],
  );
  const row = rows[0];
  const kind = row?.kind === 'list' ? 'list' : 'site';
  const fetchedAt = row?.robots_fetched_at_ms;
  return {
    kind,
    policy:
      kind === 'list'
        ? EMPTY_ROBOTS_POLICY
        : robotsPolicyFromStored(row?.robots_disallow),
    robotsFetchedAt:
      typeof fetchedAt === 'number' && Number.isFinite(fetchedAt)
        ? fetchedAt
        : null,
    sitemaps:
      kind === 'list' ? null : robotsSitemapsFromStored(row?.robots_disallow),
  };
}

/** A robots.txt verdict this young is reused rather than read again: the
 * registration probe reads the file seconds before the first scan, which
 * used to read it a second time within milliseconds (2026-09-19
 * evaluation, K6-2). RFC 9309 §2.4 lets a crawler cache it for up to a day;
 * a minute keeps a scan's rules its own. */
const ROBOTS_REUSE_MS = 60_000;

/** Write the rules a fetch of `/robots.txt` yielded onto the corpus row —
 * the scan's own persistence, and the registration probe's, so the two
 * share one read. */
export async function persistRobotsRules(
  sql: Sql,
  domain: string,
  rules: RobotsRules,
): Promise<void> {
  // The `::jsonb` cast types the parameter, so the driver serializes the
  // value itself — a pre-stringified object would be stored as a JSON string.
  await sql.unsafe(
    `UPDATE ${PUBLIC_WEB_SCHEMA}.websites
        SET robots_disallow = $2::jsonb, robots_fetched_at = NOW()
      WHERE domain = $1`,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a JSON-shaped policy object for the `::jsonb` param
    [domain, robotsPolicyToStored(rules, rules.sitemaps) as JSONValue],
  );
}

/**
 * The robots.txt rules a scan honours — the group that names this crawler
 * (`User-agent: TaleBot`), else the `*` group — read at the start of every
 * scan and persisted on the corpus row so the discovery walk, every
 * continuation link, the rendered-page admission and the retirement pass
 * judge by the same rules. A robots.txt that answers 2xx is the rules; one
 * that answers anything else is "no rules" — a site without one allows
 * everything; a fetch that fails keeps the last persisted rules rather than
 * crawling unruled, which is what a transient miss used to do.
 */
async function loadRobotsRules(
  sql: Sql,
  domain: string,
  persisted: RobotsPolicy,
  fresh: { fetchedAt: number | null; sitemaps: readonly string[] | null } = {
    fetchedAt: null,
    sitemaps: null,
  },
): Promise<RobotsRules> {
  if (
    fresh.fetchedAt !== null &&
    fresh.sitemaps !== null &&
    Date.now() - fresh.fetchedAt < ROBOTS_REUSE_MS
  ) {
    return { ...persisted, sitemaps: [...fresh.sitemaps] };
  }
  const hosts = siteHosts(domain);
  const url = `https://${domain}/robots.txt`;
  let rules: RobotsRules;
  try {
    assertCrawlableUrl(url);
    const robots = await safeFetch(url, {
      timeoutMs: PAGE_TIMEOUT_MS,
      maxResponseBytes: ROBOTS_TXT_MAX_BYTES,
      allowedHosts: [...hosts],
      allowPrivateAddresses: privateCrawlHostsAllowed(),
      httpsOnly: true,
      headers: crawlerRequestHeaders(),
    });
    if (robots.status >= 200 && robots.status < 300) {
      rules = parseRobots(robots.body, CRAWLER_PRODUCT_TOKEN);
    } else if (robots.status >= 500 || robots.status === 429) {
      // A server error or a throttle is no answer about the rules (RFC 9309
      // §2.3.1.4 has a crawler keep a cached copy): the last known rules
      // stand, and the fetch time is not stamped.
      console.warn(
        `[crawl] ${domain}: robots.txt answered ${robots.status}, keeping the last known rules`,
      );
      return { ...persisted, sitemaps: [] };
    } else {
      // A 4xx is an answer: the site publishes no rules (§2.3.1.3).
      rules = { ...EMPTY_ROBOTS_POLICY, sitemaps: [] };
    }
  } catch (error) {
    console.warn(
      `[crawl] ${domain}: robots.txt unavailable, keeping the last known rules:`,
      error instanceof Error ? error.message : error,
    );
    return { ...persisted, sitemaps: [] };
  }
  await persistRobotsRules(sql, domain, rules);
  return rules;
}

/** Take the corpus-side claim on a domain (`claimed`), or report that
 * another scan holds it (`held`) or that the domain has no corpus row at all
 * (`missing` — the two zero-row cases must not be conflated: a held claim is
 * routine, a missing row is a failure to record). A claim older than
 * {@link STUCK_SCAN_TAKEOVER} belongs to a crashed scan and is taken over,
 * and so is the claim whose heartbeat is `takeover` — the one the scheduler
 * established has no scan left behind it. Compared by value, so a claim
 * that was taken or refreshed since is another scan's and stays held. The
 * heartbeat travels as text and is cast by the server: bound as a timestamp
 * the driver would round it to the millisecond, and it would match nothing. */
async function claimScan(
  sql: Sql,
  domain: string,
  takeover?: string,
): Promise<'claimed' | 'held' | 'missing'> {
  const rows = await sql.unsafe<{ domain: string }[]>(
    `UPDATE ${PUBLIC_WEB_SCHEMA}.websites
        SET status = 'scanning', error = NULL, updated_at = NOW()
      WHERE domain = $1
        AND (status NOT IN ('scanning', 'deleting')
             OR (status = 'scanning'
                 AND (updated_at < NOW() - INTERVAL '${STUCK_SCAN_TAKEOVER}'
                      OR updated_at = $2::text::timestamptz)))
      RETURNING domain`,
    [domain, takeover ?? null],
  );
  if (rows.length > 0) return 'claimed';
  const present = await sql.unsafe<{ domain: string }[]>(
    `SELECT domain FROM ${PUBLIC_WEB_SCHEMA}.websites WHERE domain = $1`,
    [domain],
  );
  return present.length > 0 ? 'held' : 'missing';
}

/** Discover the domain's URLs (the robots-declared sitemaps first, link-walk
 * as the fallback) under the robots rules the scan read, and record them as
 * `discovered` rows for the fetch loop. `deadline` bounds the fetching: a
 * discovery cut short records what it has — the next scan's discovery pass
 * tops the frontier up. */
async function discoverAndRecordUrls(
  sql: Sql,
  domain: string,
  deadline: number,
  robots: RobotsRules,
  scanStartedAt: string,
): Promise<void> {
  const hosts = siteHosts(domain);
  const baseUrl = `https://${domain}/`;

  // The conventional sitemap location is a guess and robots.txt governs it
  // like any URL; a sitemap the file advertises is the site's own
  // instruction to read it. A `Disallow: /` site used to have its
  // `/sitemap.xml` and homepage fetched all the same (2026-09-18
  // evaluation, J6-5).
  const guessed = `https://${domain}/sitemap.xml`;
  let sitemapCandidates: string[] = isUrlDisallowed(guessed, robots)
    ? []
    : [guessed];
  const advertised = robots.sitemaps.filter((sitemapUrl) => {
    try {
      return hosts.has(new URL(sitemapUrl).hostname.toLowerCase());
    } catch {
      return false;
    }
  });
  if (advertised.length > 0) sitemapCandidates = advertised;

  const urls = new Set<string>();
  const admit = (candidate: string): boolean => {
    const normalized = normalizeCandidateUrl(candidate, baseUrl, hosts);
    if (!normalized) return false;
    if (isUrlDisallowed(normalized, robots)) return false;
    if (urls.size >= MAX_URLS_PER_DOMAIN) return true;
    urls.add(normalized);
    return urls.size >= MAX_URLS_PER_DOMAIN;
  };
  admit(baseUrl);

  // Every discovery request is paced like a content fetch — the site's
  // `Crawl-delay` on a sitemap read, the fetch floor or the delay on a
  // link-walk read — measured from the previous request, robots.txt
  // included: the first sitemap and the first homepage read used to go
  // out unpaced (2026-09-19 evaluation, K6-2).
  let lastRequestAt = Date.now();
  const pace = async (delayMs: number): Promise<void> => {
    const wait = delayMs - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
  };

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
      assertCrawlableUrl(next.url);
      await pace(robots.crawlDelayMs);
      const response = await safeFetch(next.url, {
        timeoutMs: PAGE_TIMEOUT_MS,
        maxResponseBytes: SITEMAP_MAX_BYTES,
        allowedHosts: [...hosts],
        allowPrivateAddresses: privateCrawlHostsAllowed(),
        httpsOnly: true,
        headers: crawlerRequestHeaders(),
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

  // Link-walk fallback for sites without a useful sitemap. A URL the rules
  // cover — the homepage included — is never dialed for its links either.
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
      if (isUrlDisallowed(next.url, robots)) continue;
      fetches += 1;
      try {
        assertCrawlableUrl(next.url);
        await pace(fetchDelayMs(robots));
        const response = await safeFetch(next.url, {
          timeoutMs: PAGE_TIMEOUT_MS,
          maxResponseBytes: PAGE_MAX_BYTES,
          allowedHosts: [...hosts],
          allowPrivateAddresses: privateCrawlHostsAllowed(),
          httpsOnly: true,
          headers: crawlerRequestHeaders(),
        });
        if (response.status < 200 || response.status >= 300) continue;
        for (const normalized of discoverableLinks(
          response.body,
          next.url,
          hosts,
          robots,
        )) {
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
    }
  }

  if (urls.size >= MAX_URLS_PER_DOMAIN) {
    console.warn(
      `[crawl] ${domain}: URL cap of ${MAX_URLS_PER_DOMAIN} reached; larger sites are crawled partially`,
    );
  }

  // The shared admission door: new rows start `discovered`, and a row a past
  // scan marked `deleted` is revived — the site links to the page again, so
  // the fetch (not the memory of a 404) decides whether it is back. What
  // this scan retired itself (a resumed scan's discovery) stays retired.
  await admitUrls(sql, domain, [...urls], {
    listed: false,
    retiredBefore: scanStartedAt,
  });
  console.log(`[crawl] ${domain}: ${urls.size} URLs discovered`);
}

interface DuePage {
  readonly url: string;
  readonly content_hash: string | null;
  /** An operator-listed URL: the robots rules do not govern it, and a 404
   * keeps its row. */
  readonly listed: boolean;
}

const DUE_PAGE_PREDICATE = `
      domain = $1 AND status <> 'deleted'
      AND (listed OR fail_count < ${MAX_FETCH_FAILURES}
           OR last_crawled_at < $2::timestamptz - interval '${BENCHED_PAGE_RETRY_INTERVAL}')
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
    `SELECT url, content_hash, listed
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

type FetchOutcome = StoreOutcome | 'failed' | 'render';

/** Whether a redirect landed on another host or path of the site — not
 * merely on the same address with another query string. */
function isAnotherAddress(from: string, to: string): boolean {
  const source = new URL(from);
  const target = new URL(to);
  return (
    source.hostname !== target.hostname || source.pathname !== target.pathname
  );
}

/**
 * Probe one page and dispatch on its content type: binaries and plain text
 * are extracted and stored in-process; HTML reports `render` (body
 * discarded, row left unmarked) so the caller batches it through the
 * sandboxed browser. The probe is the sole authority on page LIFECYCLE —
 * status codes, deletes, size caps, and the SSRF guard for every byte
 * download. Change detection is the stored content hash alone: a 304 on an
 * SPA shell proves nothing about rendered content, so no conditional
 * validators are sent. Exported for tests only.
 */
export async function fetchAndStorePage(
  sql: Sql,
  domain: string,
  page: DuePage,
  policy: RobotsPolicy,
  scanStartedAt?: string,
): Promise<FetchOutcome> {
  const hosts = siteHosts(domain);

  // Defence in depth for a row admitted before the rules were known — an
  // earlier release's discovery, a rule the site added since: a non-listed
  // URL robots.txt disallows is never dialed, and leaves the index the way
  // the retirement pass would have retired it.
  if (!page.listed && isUrlDisallowed(page.url, policy)) {
    await retirePage(sql, domain, page.url);
    return 'unchanged';
  }

  let response;
  try {
    assertCrawlableUrl(page.url);
    response = await safeFetchBinary(page.url, {
      timeoutMs: PAGE_FETCH_TIMEOUT_MS,
      maxResponseBytes: DOCUMENT_MAX_BYTES,
      allowedHosts: [...hosts],
      allowPrivateAddresses: privateCrawlHostsAllowed(),
      httpsOnly: true,
      headers: crawlerRequestHeaders(),
    });
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    // The refusal is the row's record, kind included: a redirect into a
    // private address the guard refused before dialing, a DNS miss and a
    // timeout used to leave the same silent `discovered` row — from the
    // API nobody could tell a blocked redirect from a dialed one. A page
    // slower than the budget is the `timeout` the contract names, in the
    // crawler's own words (2026-09-14 evaluation, h5).
    const kind: PageFailureKind =
      error instanceof SafeFetchError ? error.kind : 'network_error';
    const message =
      kind === 'timeout'
        ? `The page did not finish downloading within ${PAGE_FETCH_TIMEOUT_MS / 1000} seconds`
        : kind === 'host_not_allowed'
          ? // A redirect off the registered site: the right refusal, which
            // used to wear the `private_ip` label (2026-09-18 evaluation,
            // J6-6).
            `The page redirected off the site, which the crawler does not follow (${cause})`
          : cause;
    console.warn(`[crawl] ${page.url}: fetch failed (${kind}): ${cause}`);
    await recordPageFailure(sql, domain, page.url, { kind, message });
    return 'failed';
  }

  if (response.status === 404 || response.status === 410) {
    const answer = `The page answered HTTP ${response.status}${
      response.statusText === '' ? '' : ` ${response.statusText}`
    }`;
    if (page.listed) {
      // A LISTED page the site says is gone keeps its row: the operator
      // asked for it by name, so the list shows the answer — content and
      // chunks purged, `http_error` naming the status, `failCount` counting
      // the scans it has been gone — and it is probed again every scan, as
      // listed rows are. Pruning it used to leave a no-signal `discovered`
      // row on the next scan's revival (2026-09-14 evaluation, h5).
      await purgePageContent(sql, domain, page.url);
      await recordPageFailure(sql, domain, page.url, {
        kind: 'http_error',
        message: answer,
      });
      return 'failed';
    }
    // The page is gone — drop it from the index. Discovery being partial
    // (BFS depth, the URL cap) means absence from a scan proves nothing,
    // but a 404 from the site itself does.
    await retirePage(sql, domain, page.url);
    return 'unchanged';
  }
  if (response.status < 200 || response.status >= 300) {
    await recordPageFailure(sql, domain, page.url, {
      kind: 'http_error',
      message: `The page answered HTTP ${response.status}${
        response.statusText === '' ? '' : ` ${response.statusText}`
      }`,
    });
    return 'failed';
  }
  // A redirect inside the site makes this URL another page's alias: `www.`
  // onto the apex, a missing trailing slash, a removed page sent to the
  // homepage. Stored under both addresses, the same text was chunked,
  // embedded and cited twice. The alias leaves the index and its target
  // joins the frontier — unless robots.txt disallows it — to be fetched
  // under its own address. A LISTED URL is the operator's instruction and
  // keeps its row, and a redirect that only rewrites the query (a session
  // id, a language parameter) is the same address: following those would
  // mint a new row every scan.
  if (!page.listed) {
    const target = normalizeCandidateUrl(response.finalUrl, page.url, hosts);
    if (target !== null && isAnotherAddress(page.url, target)) {
      await retirePage(sql, domain, page.url);
      if (!isUrlDisallowed(target, policy)) {
        await admitUrls(sql, domain, [target], {
          listed: false,
          ...(scanStartedAt === undefined
            ? {}
            : { retiredBefore: scanStartedAt }),
        });
      }
      return 'unchanged';
    }
  }
  // The origin's own wish, in the HTTP form (`X-Robots-Tag: noindex` — the
  // only way a site can say so for a non-HTML resource such as a PDF): an
  // honest terminal reason on the row, nothing stored. The crawler reads
  // robots.txt at discovery; it used to ignore this directive entirely
  // (2026-09-14 evaluation, g4-10).
  const robotsHeader = response.headers.get('x-robots-tag');
  if (robotsHeaderForbidsIndexing(robotsHeader)) {
    // What an earlier scan stored leaves the index with the wish.
    await purgePageContent(sql, domain, page.url);
    await recordPageFailure(sql, domain, page.url, {
      kind: 'robots_noindex',
      message: `The origin asked not to index this page (X-Robots-Tag: ${robotsHeader ?? ''})`,
    });
    return 'failed';
  }
  const contentType = response.headers.get('content-type') ?? '';
  let dispatch = classifyContentType(
    contentType,
    response.headers.get('content-disposition'),
  );
  if (dispatch.kind === 'skip') {
    // Not something this lane can turn into text (an image, a feed, a
    // binary download). Recorded as a failure with its own kind — the scan
    // moves on, `discovered` stays honest ("every attempt failed"), and the
    // 5-strike rule stops re-probing a JSON endpoint on a whole-site crawl.
    // It used to clear the row silently, so a URL the crawler had looked at
    // and rejected read exactly like one never fetched (2026-09-14
    // evaluation, g4-3).
    await recordPageFailure(sql, domain, page.url, {
      kind: 'unsupported_content',
      message: `The page answered ${contentType === '' ? 'no content type' : `"${contentType}"`}, which the crawler cannot turn into text (HTML, plain text, PDF, DOCX, XLSX, PPTX, ODT)`,
    });
    return 'failed';
  }
  if (dispatch.kind === 'html') {
    // Content comes from the rendered DOM, not this probe body — the page
    // joins the render batch and its row stays unmarked until the batch
    // settles it.
    return 'render';
  }
  const bytes = new Uint8Array(await response.body.arrayBuffer());
  if (dispatch.kind === 'sniff') {
    // A download whose declared type says nothing or the wrong thing: the
    // bytes decide. A TYPO3 export answered `application/vnd.ms-excel` with
    // an `.xlsx` named in its Content-Disposition, and read as unsupported
    // (2026-09-30).
    const extension = await sniffDocumentExtension(bytes);
    if (extension === null) {
      const named = dispatch.filename === null ? '' : ` (${dispatch.filename})`;
      await recordPageFailure(sql, domain, page.url, {
        kind: 'unsupported_content',
        message: `The page answered ${contentType === '' ? 'no content type' : `"${contentType}"`}${named}, and its bytes are not a document the crawler reads (PDF, DOCX, XLSX, PPTX, ODT)`,
      });
      return 'failed';
    }
    dispatch = { kind: 'document', extension, filename: dispatch.filename };
  }

  let title: string | null;
  let text: string;
  if (dispatch.kind === 'text') {
    title = null;
    text = new TextDecoder().decode(bytes);
  } else {
    const name = documentNameForUrl(
      page.url,
      dispatch.extension,
      dispatch.filename,
    );
    try {
      // The crawl lane carries no vision arm; extractors degrade on their
      // own (scanned PDF pages come back empty instead of failing).
      const [extracted] = await extractText(bytes, name, {
        visionClient: null,
        processImages: false,
      });
      text = extracted;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[crawl] ${page.url}: extraction failed for ${name}: ${message}`,
      );
      // A failure like any other — it used to be recorded as a plain visit
      // (`fail_count` reset, nothing stored, no trace), so a document no
      // extractor could read was re-fetched every scan for ever and never
      // said so.
      await recordPageFailure(sql, domain, page.url, {
        kind: 'extraction_failed',
        message: `Text extraction failed for ${name}: ${message}`,
      });
      return 'failed';
    }
    title = name;
  }
  return await storePageText(sql, domain, page, title, text);
}

/**
 * What storing a page means for its chunks: `changed` text (or text whose
 * chunks are missing or were cut from other text — an earlier scan died
 * between storing the page and indexing it) is re-chunked and re-embedded;
 * `vectorless` text is unchanged but was chunked without vectors (no
 * embedding model at the time), so it is embedded once a model can do it;
 * `unchanged` text is left as it is.
 */
export type StoreOutcome = 'changed' | 'vectorless' | 'unchanged';

/**
 * Store one page's extracted text, title, and paragraph hashes; report what
 * that means for its chunks ({@link StoreOutcome}). The page is not stamped
 * as visited here: that waits until it is indexed too
 * ({@link markPageCrawled}), so a link cut off in between leaves the page
 * due for the scan that resumes it. Exported for tests only.
 */
export async function storePageText(
  sql: Sql,
  domain: string,
  page: DuePage,
  title: string | null,
  text: string,
): Promise<StoreOutcome> {
  const contentHash = computeContentHash(text);
  const wordCount = text.split(/\s+/).filter((word) => word.length > 0).length;

  const unchanged = page.content_hash === contentHash;
  await sql.begin(async (tx) => {
    await tx.unsafe(
      `UPDATE ${PUBLIC_WEB_SCHEMA}.website_urls
          SET content = $3, title = $4, content_hash = $5, word_count = $6,
              status = 'active', fail_count = 0,
              last_error = NULL, last_error_kind = NULL, last_error_at = NULL
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
    const [chunks] = await sql.unsafe<
      { present: boolean; current: boolean; vectorless: boolean }[]
    >(
      `SELECT count(*) > 0 AS present,
              coalesce(bool_and(content_hash = $3), false) AS current,
              coalesce(bool_or(embedding IS NULL), false) AS vectorless
         FROM ${PUBLIC_WEB_SCHEMA}.chunks
        WHERE domain = $1 AND url = $2`,
      [domain, page.url, contentHash],
    );
    // Chunks of other text: the text was stored and the scan stopped before
    // it was indexed. Left alone, the index kept serving the old text until
    // the page changed again.
    if (chunks === undefined || !chunks.present || !chunks.current) {
      return 'changed';
    }
    return chunks.vectorless ? 'vectorless' : 'unchanged';
  }
  return 'changed';
}

/** Stamp a page as visited by this scan, once it is stored and indexed. */
async function markPageCrawled(
  sql: Sql,
  domain: string,
  url: string,
): Promise<void> {
  await sql.unsafe(
    `UPDATE ${PUBLIC_WEB_SCHEMA}.website_urls SET last_crawled_at = NOW()
      WHERE domain = $1 AND url = $2`,
    [domain, url],
  );
}

/**
 * Drop what a page put in the index — its chunks, its paragraph hashes, its
 * stored text — for a page the crawler may no longer serve: gone from the
 * site, or asked not to be indexed. The row stays, so the page list still
 * says why; a stored row falls back to `discovered`.
 */
async function purgePageContentIn(
  tx: TransactionSql,
  domain: string,
  url: string,
): Promise<void> {
  await tx.unsafe(
    `DELETE FROM ${PUBLIC_WEB_SCHEMA}.chunks WHERE domain = $1 AND url = $2`,
    [domain, url],
  );
  await tx.unsafe(
    `DELETE FROM ${PUBLIC_WEB_SCHEMA}.page_paragraph_hashes
      WHERE domain = $1 AND url = $2`,
    [domain, url],
  );
  await tx.unsafe(
    `UPDATE ${PUBLIC_WEB_SCHEMA}.website_urls
        SET content = NULL, content_hash = NULL, word_count = 0,
            status = CASE WHEN status = 'deleted' THEN status ELSE 'discovered' END
      WHERE domain = $1 AND url = $2`,
    [domain, url],
  );
}

async function purgePageContent(
  sql: Sql,
  domain: string,
  url: string,
): Promise<void> {
  await sql.begin((tx) => purgePageContentIn(tx, domain, url));
}

/**
 * Retire a page from the site: its content purged and the row `deleted` —
 * out of every listing and count — for a page the site answered 404/410
 * for, or one robots.txt disallows. A `deleted` row is revived only when
 * discovery admits the URL again, which for a disallowed one is the day the
 * site drops the rule.
 */
async function retirePage(
  sql: Sql,
  domain: string,
  url: string,
): Promise<void> {
  await sql.begin(async (tx) => {
    await purgePageContentIn(tx, domain, url);
    await tx.unsafe(
      `UPDATE ${PUBLIC_WEB_SCHEMA}.website_urls
          SET status = 'deleted', last_crawled_at = NOW()
        WHERE domain = $1 AND url = $2`,
      [domain, url],
    );
  });
}

/**
 * Retire every NON-listed page robots.txt now disallows — rows an earlier
 * release admitted unruled, or a rule the site added since: a well-behaved
 * crawler stops fetching them and stops serving what it stored. Listed URLs
 * are the operator's instruction and stay. Returns how many were retired.
 */
async function retireDisallowedRows(
  sql: Sql,
  domain: string,
  policy: RobotsPolicy,
): Promise<number> {
  if (policy.disallow.length === 0) return 0;
  const rows = await sql.unsafe<{ url: string }[]>(
    `SELECT url FROM ${PUBLIC_WEB_SCHEMA}.website_urls
      WHERE domain = $1 AND NOT listed AND status <> 'deleted'`,
    [domain],
  );
  let retired = 0;
  for (const row of rows) {
    if (!isUrlDisallowed(row.url, policy)) continue;
    await retirePage(sql, domain, row.url);
    retired += 1;
  }
  return retired;
}

/**
 * Admit same-site links found in a rendered page (site kind only) so SPA
 * sites — whose anchors exist only after JS runs — still grow the frontier.
 * The links pass the same seam discovery uses — host, port and asset rules,
 * then the robots rules — so a page a `Disallow` covers never joins the
 * frontier from here either (it used to: 2026-09-14 evaluation, h5).
 * Freshly admitted rows have no `last_crawled_at`, so the running scan picks
 * them up.
 */
async function admitRenderedLinks(
  sql: Sql,
  domain: string,
  html: string,
  baseUrl: string,
  policy: RobotsPolicy,
  scanStartedAt: string,
): Promise<void> {
  const hosts = siteHosts(domain);
  const countRows = await sql.unsafe<{ n: string }[]>(
    `SELECT count(*)::text AS n FROM ${PUBLIC_WEB_SCHEMA}.website_urls
      WHERE domain = $1 AND status <> 'deleted'`,
    [domain],
  );
  let tracked = Number(countRows[0]?.n ?? 0);
  for (const normalized of discoverableLinks(html, baseUrl, hosts, policy)) {
    if (tracked >= MAX_URLS_PER_DOMAIN) {
      console.warn(
        `[crawl] ${domain}: URL cap of ${MAX_URLS_PER_DOMAIN} reached during rendered-link admission`,
      );
      return;
    }
    // Inserted or revived rows are newly tracked (`deleted` rows are not in
    // the count above); unchanged live rows report zero. A link to what this
    // scan retired (the alias it just followed, a page that answered 404)
    // leaves that row retired.
    tracked += await admitUrls(sql, domain, [normalized], {
      listed: false,
      retiredBefore: scanStartedAt,
    });
  }
}

/** What a failed attempt leaves on the row: its kind (the vocabulary the
 * page list and the OpenAPI enum share) and the message. */
interface PageFailure {
  readonly kind: PageFailureKind;
  readonly message: string;
}

/** A runaway error text (a provider's whole HTML page) must not become the
 * row; the first line says what went wrong. */
const PAGE_ERROR_MAX_CHARS = 500;

/**
 * Charge a failed attempt to the row — the counter the fetch cap reads, and
 * the reason a reader of the page list gets: a row that shows `discovered`
 * with no words now says whether a guard refused a redirect, the origin
 * answered 500, or the render timed out, instead of looking like a page
 * nobody has fetched yet.
 *
 * `charge: false` records the reason and the attempt (`last_crawled_at`, so
 * the row is not claimed again this scan) without a strike — for a failure
 * that was the render sandbox's, not the page's.
 */
async function recordPageFailure(
  sql: Sql,
  domain: string,
  url: string,
  failure: PageFailure,
  options: { charge: boolean } = { charge: true },
): Promise<void> {
  await sql.unsafe(
    `UPDATE ${PUBLIC_WEB_SCHEMA}.website_urls
        SET fail_count = CASE WHEN $5::boolean THEN fail_count + 1 ELSE fail_count END,
            last_crawled_at = NOW(),
            last_error = $3, last_error_kind = $4, last_error_at = NOW()
      WHERE domain = $1 AND url = $2`,
    [
      domain,
      url,
      // Customer-facing: one line, no toolchain locations, no secrets.
      sanitizeError(publicPageError(failure.message), PAGE_ERROR_MAX_CHARS),
      failure.kind,
      options.charge,
    ],
  );
}

/**
 * A failure of the organization's embedding model — a rejected credential,
 * an exhausted balance, an outage, a model whose vectors the corpus cannot
 * hold — ends the scan as any error does, but under a reason that says so
 * and names its class: the row used to carry the provider's bare words
 * ("401 User not found.") and the page could only answer that the last scan
 * did not finish. Any other error is handed back as it is.
 */
function embeddingScanFailure(error: unknown): unknown {
  const failureClass =
    error instanceof EmbeddingDimensionMismatch
      ? 'dimension'
      : classifyEmbeddingFailure(error);
  if (failureClass === null) return error;
  // A credential refusal's own sentence, not its serialized payload.
  return new Error(
    websiteEmbeddingFailureReason(failureClass, runFailureMessage(error)),
    { cause: error },
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
 * vectors: the site's own content search reads them, knowledge search does
 * not run until a model is configured, and the first scan after that embeds
 * them even though their text has not changed (`vectorless`). Exported for
 * tests only.
 */
export class PageIndexer {
  private embedder: Embedder | null = null;
  private embedderResolved = false;
  private missingModelLogged = false;
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
      if (!(error instanceof EmbeddingNotConfigured)) {
        throw embeddingScanFailure(error);
      }
      if (!this.missingModelLogged) {
        this.missingModelLogged = true;
        console.warn(
          `[crawl] ${domain}: no embedding model configured for "${orgSlug}" — chunks are stored without vectors until one is`,
        );
      }
    }
    if (this.embedder) {
      const dbUrl = await resolveOrgUrl(orgSlug);
      try {
        await pinDimensions({
          sql: this.sql,
          dbUrl,
          schema: PUBLIC_WEB_SCHEMA,
          dimensions: this.embedder.dimensions,
          context: `organization "${orgSlug}" (website crawl)`,
        });
      } catch (error) {
        throw embeddingScanFailure(error);
      }
    }
    return this.embedder;
  }

  /** The chunks' vectors, or null without an embedding model. */
  private async embed(texts: string[]): Promise<number[][] | null> {
    const embedder = await this.resolveEmbedder();
    if (embedder === null) return null;
    try {
      return await embedder.embedAll(texts);
    } catch (error) {
      throw embeddingScanFailure(error);
    }
  }

  /**
   * Embed the site's pages whose chunks still lack vectors, from their
   * stored text, until `deadline`: pages stored while the organization had
   * no embedding model. A scan that was running when an admin saved one
   * used to keep them so — each was done for that scan — until its next
   * interval, up to thirty days. The model is looked for again when this
   * link found none: it may have been saved since. Returns how many such
   * pages are left for a later link; none when there is no model.
   */
  async embedVectorless(deadline: number): Promise<number> {
    const { domain } = this.identity;
    const vectorless = (limit: number) =>
      this.sql.unsafe<{ url: string }[]>(
        `SELECT DISTINCT c.url
           FROM ${PUBLIC_WEB_SCHEMA}.chunks c
           JOIN ${PUBLIC_WEB_SCHEMA}.website_urls u
             ON u.domain = c.domain AND u.url = c.url
          WHERE c.domain = $1 AND c.embedding IS NULL
            AND u.status = 'active' AND u.content IS NOT NULL
          ORDER BY c.url
          LIMIT $2`,
        [domain, limit],
      );
    if ((await vectorless(1)).length === 0) return 0;
    if (this.embedderResolved && this.embedder === null) {
      this.embedderResolved = false;
    }
    if ((await this.resolveEmbedder()) === null) return 0;
    // Once each: a page this pass indexed has vectors or no chunks left.
    const done = new Set<string>();
    while (Date.now() < deadline) {
      const batch = (await vectorless(EMBED_BATCH_PAGES + done.size)).filter(
        (row) => !done.has(row.url),
      );
      if (batch.length === 0) break;
      for (const { url } of batch) {
        if (Date.now() >= deadline) break;
        done.add(url);
        await this.indexPage(url);
      }
    }
    const [left] = await this.sql.unsafe<{ n: string }[]>(
      `SELECT count(DISTINCT c.url)::text AS n
         FROM ${PUBLIC_WEB_SCHEMA}.chunks c
         JOIN ${PUBLIC_WEB_SCHEMA}.website_urls u
           ON u.domain = c.domain AND u.url = c.url
        WHERE c.domain = $1 AND c.embedding IS NULL
          AND u.status = 'active' AND u.content IS NOT NULL`,
      [domain],
    );
    return Number(left?.n ?? '0');
  }

  /** Index a page if its store outcome calls for it: changed text always,
   * text chunked without vectors once a model can embed it. */
  async settle(url: string, outcome: StoreOutcome): Promise<void> {
    if (outcome === 'unchanged') return;
    if (outcome === 'vectorless' && (await this.resolveEmbedder()) === null) {
      return;
    }
    await this.indexPage(url);
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
    const vectors = await this.embed(chunks.map((chunk) => chunk.embedText));
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

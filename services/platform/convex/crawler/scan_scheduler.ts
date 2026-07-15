'use node';

// Website scan scheduler — the in-process port of the former standalone crawler
// service's poll loop (it scanned every "due" website on an interval). When the
// crawler moved in-process, the per-step actions (discover/fetch/index) were
// ported but this driver was not, so registered websites never got crawled.
// `scanDueWebsites` (a Convex cron) restores that: it finds due websites and
// schedules `scanWebsite` for each. Every corpus read/write is routed to the
// owning org's knowledge pool (bring-your-own or the deployment default), so the
// crawler corpus is isolated per-org exactly like the RAG corpus.

import { v } from 'convex/values';
import type { Sql } from 'postgres';

import { getString, isRecord } from '../../lib/utils/type-utils';
import { components, internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { isE2ECronSuppressed } from '../lib/e2e_cron_guard';
import {
  getKnowledgePoolForOrg,
  resolveKnowledgeUrlForOrg,
} from '../lib/knowledge/db/knowledge_db';
import { indexPages } from './lib/indexing_service';
import {
  countUncrawledUrls,
  getDueWebsites,
  getUrlsNeedingRecrawl,
  updateLastScanned,
  updateScanStatus,
} from './lib/website_store';

const envInt = (name: string, fallback: number): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// Discovery (sitemap parse) is cheap, so discover the WHOLE site up front — the
// original standalone crawler ran `discover_urls(max_urls=-1)` (unlimited) and a
// per-scan cap of 100 was a regression that pinned every multi-hundred-page site
// at exactly 100. Bound only by a generous safety cap so a pathological sitemap
// can't blow one action's memory. Override via `CRAWLER_MAX_DISCOVER_URLS`.
const MAX_DISCOVER_URLS = envInt('CRAWLER_MAX_DISCOVER_URLS', 10_000);
// Crawling (fetch + chunk + embed each page) is expensive. Bound each action by
// WALL-CLOCK rather than page count: a Convex node action is hard-killed near
// ~10 min WITHOUT running its catch/reschedule, so a fixed 100-page batch on a
// slow site overran the budget and the chain died with status stuck 'scanning'.
// We crawl in small batches until this budget elapses, then reschedule a fresh
// action — so coverage is unbounded across the chain while each action stays
// safely within the kill limit. Override via `CRAWLER_SCAN_ACTION_BUDGET_MS`.
const SCAN_ACTION_BUDGET_MS = envInt('CRAWLER_SCAN_ACTION_BUDGET_MS', 300_000);
const FETCH_BATCH_SIZE = 20;
// Hard cap on the self-continuation chain length from a single trigger, so a
// huge site can't schedule an unbounded action chain in one go; the next cron
// tick (or a manual re-scan) resumes any remainder. Override via
// `CRAWLER_MAX_SCAN_CONTINUATIONS`.
const MAX_SCAN_CONTINUATIONS = envInt('CRAWLER_MAX_SCAN_CONTINUATIONS', 100);
// A URL that fails this many fetches is dropped from both the crawl list and the
// remaining-work count, so a permanently-broken page can't wedge the loop.
const MAX_FETCH_FAIL_COUNT = 10;
// Duty-cycle pacing. Crawl actions run INSIDE the shared Convex backend
// process (see helpers/parse_html.ts) — an unpaced chain runs flat-out for
// SCAN_ACTION_BUDGET_MS × MAX_SCAN_CONTINUATIONS and starves interactive
// traffic (observed: backend-wide "Try again later" mutation failures and a
// WebSocket 1011 disconnect loop while one site scanned). A pause between
// fetch batches and between chain continuations keeps the backend
// responsive; both are operator-tunable like the other CRAWLER_* knobs.
const FETCH_BATCH_PACING_MS = envInt('CRAWLER_FETCH_BATCH_PACING_MS', 2_000);
const CONTINUATION_PACING_MS = envInt('CRAWLER_CONTINUATION_PACING_MS', 5_000);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Scan ONE website incrementally. On the first action of a chain
 * (`continuation === 0`) it discovers the FULL URL set (cheap sitemap parse;
 * `ON CONFLICT DO NOTHING` dedups, so re-discovery is idempotent and picks up
 * newly-published pages). Every action then crawls a bounded batch of
 * not-yet-crawled URLs (fetch → chunk → embed into the `public_web` corpus) and,
 * if uncrawled pages remain, schedules itself again in a fresh action — so a
 * multi-thousand-page site is fully indexed across a chain of budget-sized
 * actions instead of being capped at one action's worth.
 *
 * Every corpus operation runs on the org's own knowledge pool (`sql`), resolved
 * once up front from `orgSlug`, so a bring-your-own database isolates the org's
 * crawler corpus entirely — nothing reaches for the shared default pool.
 *
 * A failure is recorded on the website row (status 'error') rather than thrown,
 * so the scheduler treats each site independently.
 */
export const scanWebsite = internalAction({
  args: {
    domain: v.string(),
    orgSlug: v.string(),
    // Position in the self-continuation chain (0 = first action of this scan).
    continuation: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (
    ctx,
    { domain, orgSlug, continuation = 0 },
  ): Promise<null> => {
    // Route every corpus read/write to the org's own knowledge pool (BYO or the
    // deployment default) — never the shared default pool.
    const sql = await getKnowledgePoolForOrg(orgSlug);

    // Best-effort push of the live corpus state onto the per-org Convex
    // `websites` row the UI reads. Called after every fetch batch so the
    // Indexed count climbs smoothly during the crawl (not only at continuation
    // boundaries), and once more at the end for the terminal idle/error state.
    // Wrapped so a sync hiccup never masks the real scan outcome.
    const pushRowSync = async (): Promise<void> => {
      try {
        await ctx.runAction(
          internal.websites.internal_actions.syncWebsiteRowForDomain,
          { orgSlug, domain },
        );
      } catch (syncErr) {
        const message =
          syncErr instanceof Error ? syncErr.message : String(syncErr);
        console.error(
          `[scanWebsite] convex-row sync failed for ${domain}: ${message}`,
        );
      }
    };

    // Refresh status (and `updated_at`) on every continuation so a long chain is
    // never mistaken for a stuck 'scanning' row by getDueWebsites' >2h check.
    await updateScanStatus(sql, domain, 'scanning');
    const deadline = Date.now() + SCAN_ACTION_BUDGET_MS;
    try {
      // 1. Discover the full frontier once per chain.
      if (continuation === 0) {
        await ctx.runAction(internal.crawler.index_pages.discoverUrls, {
          orgSlug,
          domain,
          maxUrls: MAX_DISCOVER_URLS,
        });
      }

      // 2. Crawl + index not-yet-crawled pages in small batches until the
      //    wall-clock budget elapses or the site is fully crawled. Each fetched
      //    page is indexed individually (chunk + embed) right after fetch — O(new
      //    pages) and resilient: if the action is killed mid-loop, the next
      //    continuation simply re-selects whatever is still uncrawled.
      //
      //    A batch that crawls successfully but reduces the uncrawled count by
      //    zero means those URLs can't be marked crawled — e.g. locale-variant
      //    URLs (`/en/…`, `/fr/…`) whose page canonicalizes to a different,
      //    already-crawled URL, so the fetched content is stored under the
      //    canonical row and the discovered row stays `content_hash IS NULL`.
      //    Without a guard the loop re-selects the same unmarkable URLs forever
      //    and the chain never goes idle. Bail after STAGNANT_BATCH_LIMIT
      //    consecutive no-progress batches.
      const STAGNANT_BATCH_LIMIT = 2;
      let prevUncrawled = await countUncrawledUrls(
        sql,
        domain,
        MAX_FETCH_FAIL_COUNT,
      );
      let stagnantBatches = 0;
      while (
        Date.now() < deadline &&
        prevUncrawled > 0 &&
        stagnantBatches < STAGNANT_BATCH_LIMIT
      ) {
        // Uncrawled / never-attempted URLs sort first (NULLS FIRST), so failed
        // pages are retried only after fresh ones and drop out past the budget.
        const batch = await getUrlsNeedingRecrawl(
          sql,
          domain,
          FETCH_BATCH_SIZE,
          null,
          MAX_FETCH_FAIL_COUNT,
        );
        if (batch.length === 0) break;

        const fetched = await ctx.runAction(
          internal.crawler.index_pages.fetchUrls,
          { orgSlug, domain, urls: batch },
        );
        // Index just the pages we fetched (chunk + embed), concurrency-bounded.
        // Indexing the batch directly is O(batch); calling indexWebsite here
        // would rescan the whole corpus each time (O(n²) over the chain).
        await indexPages(
          sql,
          orgSlug,
          domain,
          fetched.pages.map((page) => ({
            url: page.url,
            title: page.title ?? null,
            content: page.content,
          })),
        );
        await updateLastScanned(sql, domain);
        // Surface progress to the UI after each batch (crawled_count just grew).
        await pushRowSync();

        const nowUncrawled = await countUncrawledUrls(
          sql,
          domain,
          MAX_FETCH_FAIL_COUNT,
        );
        stagnantBatches =
          nowUncrawled < prevUncrawled ? 0 : stagnantBatches + 1;
        prevUncrawled = nowUncrawled;
        // Yield between batches so interactive traffic gets the backend (a
        // trailing pause on the final batch is a harmless 2s).
        await sleep(FETCH_BATCH_PACING_MS);
      }

      // 3. More to crawl? Continue in a fresh action (resets the budget) until
      //    the whole site is indexed or the continuation cap is hit. Don't
      //    reschedule if we stalled on unmarkable URLs (the remainder can never
      //    be crawled — going idle is correct).
      const remaining = await countUncrawledUrls(
        sql,
        domain,
        MAX_FETCH_FAIL_COUNT,
      );
      if (
        remaining > 0 &&
        stagnantBatches < STAGNANT_BATCH_LIMIT &&
        continuation < MAX_SCAN_CONTINUATIONS
      ) {
        await ctx.scheduler.runAfter(
          CONTINUATION_PACING_MS,
          internal.crawler.scan_scheduler.scanWebsite,
          { domain, orgSlug, continuation: continuation + 1 },
        );
      } else {
        await updateScanStatus(sql, domain, 'idle');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[scanWebsite] scan failed for ${domain}: ${message}`);
      await updateScanStatus(sql, domain, 'error', message);
    }
    // Final push for the terminal state (idle / error + final counts). The
    // per-batch syncs above keep the UI live during the crawl; this captures the
    // last batch's index results and the resolved status. Outside the try so a
    // sync hiccup never masks the real scan outcome.
    await pushRowSync();
    return null;
  },
});

/**
 * Cron entry: scan every website whose `scan_interval` has elapsed (or that has
 * been stuck mid-scan > 2h — see getDueWebsites). Each due site is marked
 * `scanning` up front (so the next cron tick won't re-pick it) and scanned in
 * its own scheduled action, so one slow/failing site never blocks the others.
 *
 * Per-org isolation: each org's crawler corpus lives in its own knowledge
 * database (bring-your-own) or the shared deployment default, so this enumerates
 * every org, resolves its pool, and sweeps each DISTINCT pool once — co-tenant
 * orgs on the same database share a pool, so a URL-dedup avoids re-querying it.
 * A single default-pool sweep would silently miss every BYO org. Best-effort per
 * org: one org's failure (invalid BYO config, unreachable database) is logged
 * and never aborts the sweep. Better Auth `organization` rows are cursor-
 * paginated, matching the config-cache reconcile.
 */
export const scanDueWebsites = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    if (isE2ECronSuppressed()) return null;

    const seenUrls = new Set<string>();
    let staggerIndex = 0;
    let cursor: string | null = null;
    let prevCursor: string | null | undefined;
    let isDone = false;
    let pages = 0;
    const MAX_PAGES = 1000;

    while (!isDone) {
      if (pages++ >= MAX_PAGES) {
        console.warn('[scanDueWebsites] org page cap hit; stopping');
        break;
      }
      if (prevCursor !== undefined && cursor === prevCursor) {
        console.warn('[scanDueWebsites] org cursor did not advance; stopping');
        break;
      }
      prevCursor = cursor;

      const res: unknown = await ctx.runQuery(
        components.betterAuth.adapter.findMany,
        {
          model: 'organization',
          paginationOpts: { cursor, numItems: 200 },
          where: [],
        },
      );
      const page = isRecord(res) && Array.isArray(res.page) ? res.page : [];

      for (const raw of page) {
        if (!isRecord(raw)) continue;
        const orgSlug = getString(raw, 'slug');
        if (!orgSlug) continue;

        let url: string;
        try {
          url = await resolveKnowledgeUrlForOrg(orgSlug);
        } catch (err) {
          console.warn(
            `[scanDueWebsites] URL resolution failed for org ${orgSlug}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          continue;
        }
        if (seenUrls.has(url)) continue;

        let sql: Sql;
        try {
          sql = await getKnowledgePoolForOrg(orgSlug);
        } catch (err) {
          console.warn(
            `[scanDueWebsites] pool resolution failed for org ${orgSlug}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          continue;
        }
        seenUrls.add(url);

        let due;
        try {
          due = await getDueWebsites(sql);
        } catch (err) {
          console.warn(
            `[scanDueWebsites] due-website query failed for org ${orgSlug}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          continue;
        }

        for (const w of due) {
          await updateScanStatus(sql, w.domain, 'scanning');
          // Stagger the per-site chains instead of launching every due site at
          // once — N concurrent chains multiply the in-process load the pacing
          // above meters out.
          await ctx.scheduler.runAfter(
            staggerIndex * CONTINUATION_PACING_MS,
            internal.crawler.scan_scheduler.scanWebsite,
            { domain: w.domain, orgSlug: w.owner_org_slug },
          );
          staggerIndex += 1;
        }
      }

      cursor =
        isRecord(res) && typeof res.continueCursor === 'string'
          ? res.continueCursor
          : null;
      isDone =
        isRecord(res) && typeof res.isDone === 'boolean' ? res.isDone : true;
    }
    return null;
  },
});

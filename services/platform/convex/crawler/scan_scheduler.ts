'use node';

// Website scan scheduler — the in-process port of the former standalone crawler
// service's poll loop (it scanned every "due" website on an interval). When the
// crawler moved in-process, the per-step actions (discover/fetch/index) were
// ported but this driver was not, so registered websites never got crawled.
// `scanDueWebsites` (a Convex cron) restores that: it finds due websites and
// schedules `scanWebsite` for each.

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { isE2ECronSuppressed } from '../lib/e2e_cron_guard';
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
    await updateScanStatus(domain, 'scanning');
    const deadline = Date.now() + SCAN_ACTION_BUDGET_MS;
    try {
      // 1. Discover the full frontier once per chain.
      if (continuation === 0) {
        await ctx.runAction(internal.crawler.index_pages.discoverUrls, {
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
          domain,
          FETCH_BATCH_SIZE,
          null,
          MAX_FETCH_FAIL_COUNT,
        );
        if (batch.length === 0) break;

        const fetched = await ctx.runAction(
          internal.crawler.index_pages.fetchUrls,
          { domain, urls: batch },
        );
        // Index just the pages we fetched (chunk + embed), concurrency-bounded.
        // Indexing the batch directly is O(batch); calling indexWebsite here
        // would rescan the whole corpus each time (O(n²) over the chain).
        await indexPages(
          orgSlug,
          domain,
          fetched.pages.map((page) => ({
            url: page.url,
            title: page.title ?? null,
            content: page.content,
          })),
        );
        await updateLastScanned(domain);
        // Surface progress to the UI after each batch (crawled_count just grew).
        await pushRowSync();

        const nowUncrawled = await countUncrawledUrls(
          domain,
          MAX_FETCH_FAIL_COUNT,
        );
        stagnantBatches =
          nowUncrawled < prevUncrawled ? 0 : stagnantBatches + 1;
        prevUncrawled = nowUncrawled;
      }

      // 3. More to crawl? Continue in a fresh action (resets the budget) until
      //    the whole site is indexed or the continuation cap is hit. Don't
      //    reschedule if we stalled on unmarkable URLs (the remainder can never
      //    be crawled — going idle is correct).
      const remaining = await countUncrawledUrls(domain, MAX_FETCH_FAIL_COUNT);
      if (
        remaining > 0 &&
        stagnantBatches < STAGNANT_BATCH_LIMIT &&
        continuation < MAX_SCAN_CONTINUATIONS
      ) {
        await ctx.scheduler.runAfter(
          0,
          internal.crawler.scan_scheduler.scanWebsite,
          { domain, orgSlug, continuation: continuation + 1 },
        );
      } else {
        await updateScanStatus(domain, 'idle');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[scanWebsite] scan failed for ${domain}: ${message}`);
      await updateScanStatus(domain, 'error', message);
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
 */
export const scanDueWebsites = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    if (isE2ECronSuppressed()) return null;
    const due = await getDueWebsites();
    for (const w of due) {
      await updateScanStatus(w.domain, 'scanning');
      await ctx.scheduler.runAfter(
        0,
        internal.crawler.scan_scheduler.scanWebsite,
        { domain: w.domain, orgSlug: w.owner_org_slug },
      );
    }
    return null;
  },
});

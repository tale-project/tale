import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { internalAction, type ActionCtx } from '../_generated/server';
import { orgIdFromSlug, orgSlugFromId } from '../lib/helpers/org_slug';
import type {
  CrawlerWebsiteInfo,
  FetchChunksResult,
  FetchPagesResult,
  SearchContentResult,
} from './types';

const SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export function scanIntervalToSeconds(interval: string): number {
  switch (interval) {
    case '60m':
      return 3600;
    case '6h':
      return 21600;
    case '12h':
      return 43200;
    case '1d':
      return 86400;
    case '5d':
      return 432000;
    case '7d':
      return 604800;
    case '30d':
      return 2592000;
    default:
      return 21600;
  }
}

export async function registerDomainWithCrawler(
  ctx: ActionCtx,
  orgSlug: string,
  domain: string,
  scanInterval: string,
): Promise<void> {
  // In-process registration (replaces external crawler POST /api/v1/websites).
  const result = await ctx.runAction(
    internal.crawler.websites.registerWebsite,
    { orgSlug, domain, scanInterval: scanIntervalToSeconds(scanInterval) },
  );
  if (!result.success) {
    throw new ConvexError({
      code: 'CRAWLER_REGISTRATION_FAILED',
      message: `Failed to register website with crawler: ${result.error ?? 'unknown error'}`,
    });
  }
}

export async function updateCrawlerScanInterval(
  ctx: ActionCtx,
  orgSlug: string,
  domain: string,
  scanInterval: string,
): Promise<void> {
  const result = await ctx.runAction(
    internal.crawler.websites.updateScanInterval,
    { orgSlug, domain, scanInterval: scanIntervalToSeconds(scanInterval) },
  );
  if (!result.success) {
    // The in-process action returns `{ success:false, error }` for an unknown
    // domain or one being deleted; map the not-found case to the sentinel the
    // REST caller branches on.
    throw new ConvexError({
      code: 'CRAWLER_WEBSITE_NOT_FOUND',
      message: 'CRAWLER_WEBSITE_NOT_FOUND',
    });
  }
}

export async function deregisterDomainFromCrawler(
  ctx: ActionCtx,
  orgSlug: string,
  domain: string,
): Promise<void> {
  // In-process deregistration. A not-found domain returns `success:false`,
  // which is a no-op for our purposes (idempotent delete), so it is not an
  // error here (mirrors the old `404 is ok` behaviour).
  await ctx.runAction(internal.crawler.websites.deregister, {
    orgSlug,
    domain,
  });
}

/**
 * Delete a website row, best-effort deregistering its crawler binding first.
 *
 * The crawler deregister is best-effort: an unreachable or failing crawler
 * (e.g. the crawler datastore is down) must NOT block deletion of the website
 * record, otherwise the row can never be removed while the crawler is down
 * (#2316). Log and proceed on failure — the local row is the source of truth
 * for the UI, and a stale crawler binding is reconciled on the next scan or
 * re-add. A genuinely reachable crawler still deregisters cleanly first.
 *
 * Shared by the Convex `actions.deleteWebsite` surface and the REST
 * `deregisterAndDelete` internal action so both delete paths behave the same.
 */
export async function deregisterAndDeleteWebsiteRow(
  ctx: ActionCtx,
  websiteId: Id<'websites'>,
  orgSlug: string,
  domain: string,
): Promise<void> {
  try {
    await deregisterDomainFromCrawler(ctx, orgSlug, domain);
  } catch (error) {
    console.warn(
      `[deleteWebsite] crawler deregister failed for ${domain}, deleting row anyway: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  await ctx.runMutation(internal.websites.internal_mutations.deleteWebsite, {
    websiteId,
  });
}

/** Map the in-process `getWebsite` shape onto `CrawlerWebsiteInfo`. */
function toWebsiteInfo(website: {
  domain: string;
  title: string | null;
  description: string | null;
  page_count: number;
  crawled_count: number;
  status: string;
  last_scanned_at: string | null;
}): CrawlerWebsiteInfo {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the in-process store returns the same status string set as the WebsiteStatus union
  const status = website.status as CrawlerWebsiteInfo['status'];
  return {
    domain: website.domain,
    title: website.title,
    description: website.description,
    page_count: website.page_count,
    crawled_count: website.crawled_count,
    status,
    last_scanned_at: website.last_scanned_at,
  };
}

export async function fetchWebsiteInfo(
  ctx: ActionCtx,
  orgSlug: string,
  domain: string,
): Promise<CrawlerWebsiteInfo | null> {
  const result = await ctx.runAction(internal.crawler.websites.getWebsite, {
    orgSlug,
    domain,
  });
  return result.website ? toWebsiteInfo(result.website) : null;
}

interface WebsiteForSync {
  _id: Id<'websites'>;
  domain: string;
  pageCount?: number;
  metadata?: Record<string, unknown>;
}

async function fetchHomepageMetadata(
  ctx: ActionCtx,
  organizationId: string,
  domain: string,
): Promise<{ title?: string; description?: string } | null> {
  // In-process homepage fetch (replaces external crawler POST /api/v1/urls/fetch).
  let data;
  try {
    data = await ctx.runAction(internal.crawler.index_pages.fetchUrls, {
      domain,
      urls: [`https://${domain}/`],
      wordCountThreshold: 0,
      organizationId,
    });
  } catch (err) {
    // Surface the failure so an operator notices that title/description
    // stayed blank because the homepage fetch failed, not because the
    // site genuinely has no metadata (round-3 P2 R9-P2-c).
    console.warn(
      `[fetchHomepageMetadata] fetch failed for ${domain}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }

  const page = data.pages[0];
  if (!page) return null;

  const title = page.title || undefined;
  const sd = page.structured_data;
  const meta = sd && typeof sd === 'object' ? Reflect.get(sd, 'meta') : null;
  const og = sd && typeof sd === 'object' ? Reflect.get(sd, 'opengraph') : null;
  const metaDescription =
    meta && typeof meta === 'object' ? Reflect.get(meta, 'description') : null;
  const ogDescription =
    og && typeof og === 'object' ? Reflect.get(og, 'og:description') : null;
  const description =
    (typeof metaDescription === 'string' ? metaDescription : undefined) ||
    (typeof ogDescription === 'string' ? ogDescription : undefined) ||
    undefined;

  return { title, description };
}

export const fetchAndPatchHomepage = internalAction({
  args: {
    websiteId: v.id('websites'),
    domain: v.string(),
    organizationId: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const info = await fetchHomepageMetadata(
      ctx,
      args.organizationId,
      args.domain,
    );
    if (!info) return;

    await ctx.runMutation(internal.websites.internal_mutations.patchWebsite, {
      websiteId: args.websiteId,
      title: info.title,
      description: info.description,
    });
  },
});

export const syncWebsiteStatuses = internalAction({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const orgSlug = await orgSlugFromId(ctx, args.organizationId);
    const websites: WebsiteForSync[] = await ctx.runQuery(
      internal.websites.internal_queries.listWebsitesForSync,
      { organizationId: args.organizationId },
    );

    const now = Date.now();

    for (const website of websites) {
      const lastSync = website.metadata?.lastStatusSyncAt;
      if (typeof lastSync === 'number' && now - lastSync < SYNC_INTERVAL_MS) {
        continue;
      }

      try {
        const websiteInfo = await fetchWebsiteInfo(
          ctx,
          orgSlug,
          website.domain,
        );

        if (websiteInfo) {
          await ctx.runMutation(
            internal.websites.internal_mutations.patchWebsite,
            {
              websiteId: website._id,
              metadata: {
                ...website.metadata,
                lastStatusSyncAt: now,
                lastSyncError: undefined,
              },
              status: websiteInfo.status,
              pageCount: websiteInfo.page_count,
              crawledPageCount: websiteInfo.crawled_count,
              title: websiteInfo.title ?? undefined,
              description: websiteInfo.description ?? undefined,
              lastScannedAt: websiteInfo.last_scanned_at
                ? new Date(websiteInfo.last_scanned_at).getTime()
                : undefined,
            },
          );
        } else {
          // Crawler doesn't know about this website — mark as error
          await ctx.runMutation(
            internal.websites.internal_mutations.patchWebsite,
            {
              websiteId: website._id,
              status: 'error',
              metadata: {
                ...website.metadata,
                lastStatusSyncAt: now,
                lastSyncError:
                  'Website not found in crawler. Please delete and re-add it.',
              },
            },
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Failed to sync status for ${website.domain}: ${message}`);
        await ctx.runMutation(
          internal.websites.internal_mutations.patchWebsite,
          {
            websiteId: website._id,
            metadata: {
              ...website.metadata,
              lastStatusSyncAt: now,
              lastSyncError: message,
            },
          },
        );
      }
    }
  },
});

export const registerAndSync = internalAction({
  args: {
    websiteId: v.id('websites'),
    domain: v.string(),
    scanInterval: v.string(),
    organizationId: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const orgSlug = await orgSlugFromId(ctx, args.organizationId);
    try {
      await registerDomainWithCrawler(
        ctx,
        orgSlug,
        args.domain,
        args.scanInterval,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[registerAndSync] Failed to register domain ${args.domain}:`,
        error,
      );
      await ctx.runMutation(internal.websites.internal_mutations.patchWebsite, {
        websiteId: args.websiteId,
        status: 'error',
        metadata: { lastSyncError: message },
      });
      return;
    }

    // Async: fetch homepage title & description (non-blocking, independent of scan)
    await ctx.scheduler.runAfter(
      0,
      internal.websites.internal_actions.fetchAndPatchHomepage,
      {
        websiteId: args.websiteId,
        domain: args.domain,
        organizationId: args.organizationId,
      },
    );

    // Schedule a delayed sync to pick up scan results
    await ctx.scheduler.runAfter(
      600_000,
      internal.websites.internal_actions.syncSingleWebsite,
      {
        websiteId: args.websiteId,
        domain: args.domain,
        organizationId: args.organizationId,
      },
    );
  },
});

/**
 * Internal-action equivalent of `actions.deleteWebsite`'s body:
 * deregister the crawler binding, then delete the row. The REST
 * `DELETE /api/v1/websites/:id` path delegates to this so REST and the
 * Convex action have the same shape — without it, REST deleted the
 * `websites` row but left the crawler with a dangling registration that
 * would keep scanning and produce "website not found in crawler" errors
 * if the same domain was re-added later.
 *
 * Delegates to `deregisterAndDeleteWebsiteRow`, so the crawler deregister
 * is best-effort and can never block the row delete (#2316).
 *
 * Caller is responsible for verifying caller membership / row
 * ownership BEFORE invoking (REST: `withRestAuth` + the existing
 * `organizationId !== rc.org.organizationId` check at the call site).
 */
export const deregisterAndDelete = internalAction({
  args: {
    websiteId: v.id('websites'),
    organizationId: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const website = await ctx.runQuery(
      internal.websites.internal_queries.getWebsite,
      { websiteId: args.websiteId },
    );
    if (!website) return;
    const orgSlug = await orgSlugFromId(ctx, args.organizationId);
    await deregisterAndDeleteWebsiteRow(
      ctx,
      args.websiteId,
      orgSlug,
      website.domain,
    );
  },
});

export const syncSingleWebsite = internalAction({
  args: {
    websiteId: v.id('websites'),
    domain: v.string(),
    organizationId: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const orgSlug = await orgSlugFromId(ctx, args.organizationId);
    const website = await ctx.runQuery(
      internal.websites.internal_queries.getWebsite,
      { websiteId: args.websiteId },
    );
    if (!website) return;

    // Every patch below MUST write `lastStatusSyncAt: Date.now()`.
    // `fetchPages` debounces re-fan-out using exactly this field — if
    // the success / error / missing branches forget to stamp it, the
    // debounce gate stays permanently open and every subsequent
    // `fetchPages` call schedules a fresh sync, defeating the rate-
    // limit and reintroducing the concurrent-write race the gate was
    // added to prevent.
    const syncTimestamp = Date.now();

    try {
      const info = await fetchWebsiteInfo(ctx, orgSlug, args.domain);

      if (info) {
        await ctx.runMutation(
          internal.websites.internal_mutations.patchWebsite,
          {
            websiteId: args.websiteId,
            status: info.status,
            pageCount: info.page_count,
            crawledPageCount: info.crawled_count,
            title: info.title ?? undefined,
            description: info.description ?? undefined,
            lastScannedAt: info.last_scanned_at
              ? new Date(info.last_scanned_at).getTime()
              : undefined,
            metadata: {
              ...website.metadata,
              lastSyncError: undefined,
              lastStatusSyncAt: syncTimestamp,
            },
          },
        );
      } else {
        await ctx.runMutation(
          internal.websites.internal_mutations.patchWebsite,
          {
            websiteId: args.websiteId,
            status: 'error',
            metadata: {
              ...website.metadata,
              lastSyncError:
                'Website not found in crawler. Please delete and re-add it.',
              lastStatusSyncAt: syncTimestamp,
            },
          },
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[syncSingleWebsite] Failed to sync ${args.domain}: ${message}`,
      );
      await ctx.runMutation(internal.websites.internal_mutations.patchWebsite, {
        websiteId: args.websiteId,
        status: 'error',
        metadata: {
          ...website.metadata,
          lastSyncError: message,
          lastStatusSyncAt: syncTimestamp,
        },
      });
    }
  },
});

/**
 * Sync the per-org `websites` row for `domain` straight from the corpus, keyed
 * by `orgSlug` (not org id). Called by the in-process scan scheduler the moment
 * a crawl finishes: the scheduler is corpus-keyed (`website_org_memberships`
 * stores `org_slug`), so it resolves the org id here, finds the owning org's
 * row, and reuses `syncSingleWebsite`'s patch.
 *
 * Without this, a cron-driven scan only updated the corpus and never the
 * Convex `websites` row the UI reads, so a freshly-crawled site showed `Idle`
 * / `0` indexed until the next hourly frontend poll (debounced by
 * `lastStatusSyncAt`). No-ops when the slug or row can't be resolved (org
 * deleted, domain not tracked by that org) — this is a best-effort push.
 */
export const syncWebsiteRowForDomain = internalAction({
  args: {
    orgSlug: v.string(),
    domain: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const organizationId = await orgIdFromSlug(ctx, args.orgSlug);
    if (!organizationId) return;
    const website = await ctx.runQuery(
      internal.websites.internal_queries.getWebsiteByDomain,
      { organizationId, domain: args.domain },
    );
    if (!website) return;
    await ctx.runAction(internal.websites.internal_actions.syncSingleWebsite, {
      websiteId: website._id,
      domain: args.domain,
      organizationId,
    });
  },
});

export const fetchWebsitePages = internalAction({
  args: {
    domain: v.string(),
    organizationId: v.string(),
    offset: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  // Explicit return type: these actions call `internal.crawler.*` via
  // `ctx.runAction`, and an INFERRED return type that transitively references
  // the `internal` graph collapses the whole API type to `any`/`never` (a
  // self-referential cycle). Annotating breaks the cycle.
  handler: async (ctx, args): Promise<FetchPagesResult> => {
    const orgSlug = await orgSlugFromId(ctx, args.organizationId);
    const offset = args.offset ?? 0;
    const limit = args.limit ?? 100;

    // In-process page listing (replaces external crawler GET /api/v1/pages/{domain}).
    const data = await ctx.runAction(internal.crawler.websites.listPages, {
      orgSlug,
      domain: args.domain,
      offset,
      limit,
    });
    return {
      pages: data.pages,
      total: data.total,
      offset: data.offset,
      hasMore: data.has_more,
    };
  },
});

export const fetchPageChunks = internalAction({
  args: {
    domain: v.string(),
    url: v.string(),
    organizationId: v.string(),
  },
  handler: async (ctx, args): Promise<FetchChunksResult> => {
    const orgSlug = await orgSlugFromId(ctx, args.organizationId);

    // In-process chunk listing (replaces external crawler
    // GET /api/v1/pages/{domain}/chunks).
    const data = await ctx.runAction(internal.crawler.websites.getPageChunks, {
      orgSlug,
      domain: args.domain,
      url: args.url,
    });
    return {
      url: data.url,
      chunks: data.chunks,
      total: data.total,
    };
  },
});

export const searchWebsiteContent = internalAction({
  args: {
    domain: v.string(),
    query: v.string(),
    organizationId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SearchContentResult> => {
    const orgSlug = await orgSlugFromId(ctx, args.organizationId);
    const limit = args.limit ?? 10;

    // In-process domain-scoped hybrid search (replaces external crawler
    // POST /api/v1/search/{domain}).
    const data = await ctx.runAction(internal.crawler.search.search, {
      orgSlug,
      query: args.query,
      domain: args.domain,
      limit,
    });
    return {
      query: args.query,
      results: data.results,
      total: data.results.length,
    };
  },
});

import { v } from 'convex/values';

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

/**
 * Register a domain in the organization's `public_web` corpus and start its
 * first scan immediately — a freshly added website should show pages within
 * minutes, not wait out its scan interval.
 */
export async function registerDomainWithCrawler(
  ctx: ActionCtx,
  orgSlug: string,
  domain: string,
  scanInterval: string,
  organizationId: string,
): Promise<void> {
  await ctx.runAction(internal.knowledge.crawl_ops.registerDomainOp, {
    orgSlug,
    domain,
    scanIntervalSeconds: scanIntervalToSeconds(scanInterval),
  });
  await ctx.scheduler.runAfter(0, internal.knowledge.crawl_action.scanWebsite, {
    domain,
    orgSlug,
    organizationId,
  });
}

export async function updateCrawlerScanInterval(
  ctx: ActionCtx,
  orgSlug: string,
  domain: string,
  scanInterval: string,
): Promise<void> {
  await ctx.runAction(internal.knowledge.crawl_ops.setScanIntervalOp, {
    orgSlug,
    domain,
    scanIntervalSeconds: scanIntervalToSeconds(scanInterval),
  });
}

export async function deregisterDomainFromCrawler(
  ctx: ActionCtx,
  orgSlug: string,
  domain: string,
): Promise<void> {
  await ctx.runAction(internal.knowledge.crawl_ops.deregisterDomainOp, {
    orgSlug,
    domain,
  });
}

export async function fetchWebsiteInfo(
  ctx: ActionCtx,
  orgSlug: string,
  domain: string,
): Promise<CrawlerWebsiteInfo | null> {
  return await ctx.runAction(internal.knowledge.crawl_ops.websiteInfoOp, {
    orgSlug,
    domain,
  });
}

interface WebsiteForSync {
  _id: Id<'websites'>;
  domain: string;
  pageCount?: number;
  status?: string;
  metadata?: Record<string, unknown>;
}

async function fetchHomepageMetadata(
  ctx: ActionCtx,
  organizationId: string,
  domain: string,
): Promise<{ title?: string; description?: string } | null> {
  // The org lookup stays so an invalid org still surfaces loudly.
  void (await orgSlugFromId(ctx, organizationId));
  return await ctx.runAction(internal.knowledge.crawl_ops.homepageMetadataOp, {
    domain,
  });
}

/**
 * Delete a website row, best-effort deregistering its crawler binding first.
 * Deregistration is already a logged no-op while the crawler is offline, so
 * deletion always proceeds.
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
      // The hourly debounce never applies to a row in a transient state: a
      // row that claims to be mid-scan is exactly the one whose corpus truth
      // may have moved (or whose scan died), so every sweep re-checks it.
      const transient =
        website.status === 'scanning' || website.status === 'deleting';
      const lastSync = website.metadata?.lastStatusSyncAt;
      if (
        !transient &&
        typeof lastSync === 'number' &&
        now - lastSync < SYNC_INTERVAL_MS
      ) {
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
                // See syncSingleWebsite: null clears through the metadata
                // merge; undefined would not survive serialization.
                lastSyncError:
                  websiteInfo.status === 'error' ? websiteInfo.error : null,
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
        args.organizationId,
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
              // The crawler's own failure reason rides along with an error
              // status. Cleared with null, never undefined: undefined is
              // dropped in serialization, so the metadata merge downstream
              // would keep the stale message.
              lastSyncError: info.status === 'error' ? info.error : null,
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
    return await ctx.runAction(internal.knowledge.crawl_ops.websitePagesOp, {
      orgSlug,
      domain: args.domain,
      offset: args.offset ?? 0,
      limit: args.limit ?? 100,
    });
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
    return await ctx.runAction(internal.knowledge.crawl_ops.pageChunksOp, {
      orgSlug,
      domain: args.domain,
      url: args.url,
    });
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
    return await ctx.runAction(internal.knowledge.crawl_ops.searchContentOp, {
      orgSlug,
      domain: args.domain,
      query: args.query,
      limit: args.limit ?? 10,
    });
  },
});

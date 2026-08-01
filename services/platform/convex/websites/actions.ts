import { ConvexError, v } from 'convex/values';

import { normalizeListedUrl, siteHosts } from '../../lib/knowledge/crawl-parse';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import { action } from '../_generated/server';
import { orgSlugFromId } from '../lib/helpers/org_slug';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { toWebsiteDomain } from './create_website';
import {
  deregisterAndDeleteWebsiteRow,
  updateCrawlerScanInterval,
} from './internal_actions';
import type {
  FetchChunksResult,
  FetchPagesResult,
  SearchContentResult,
} from './types';

/**
 * Resolve a websiteId, verify the caller's org membership, return both.
 * Centralises the auth pattern that every read-side action in this file
 * needs (deleteWebsite / updateWebsite already do it inline; fetchPages /
 * fetchChunks / searchContent used to skip it, returning the foreign
 * org's private content to any authenticated caller — round-2 P1-4).
 *
 * Uses "Website not found" for both "no row" and "wrong org" so a cross-
 * org caller can't probe website existence by status code.
 */
async function loadOwnedWebsite(ctx: ActionCtx, websiteId: Id<'websites'>) {
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser)
    throw new ConvexError({
      code: 'UNAUTHENTICATED',
      message: 'Unauthenticated',
    });

  const website = await ctx.runQuery(
    internal.websites.internal_queries.getWebsite,
    { websiteId },
  );
  if (!website)
    throw new ConvexError({
      code: 'WEBSITE_NOT_FOUND',
      message: 'Website not found',
    });

  await ctx.runQuery(
    internal.websites.internal_queries.verifyOrganizationMembership,
    {
      organizationId: website.organizationId,
      userId: authUser.userId,
      email: authUser.email,
      name: authUser.name,
    },
  );

  return { website, authUser };
}

export const createWebsite = action({
  args: {
    organizationId: v.string(),
    domain: v.string(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    // Runtime validation happens at the internal mutation chokepoint
    // (`provisionWebsite`), which every write path funnels through.
    scanInterval: v.string(),
    // Present = a curated URL list on this domain instead of a whole-site
    // crawl. Every entry must live on the domain (or its www/apex sibling).
    urls: v.optional(v.array(v.string())),
  },
  returns: v.id('websites'),
  handler: async (ctx, args): Promise<Id<'websites'>> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser)
      throw new ConvexError({
        code: 'UNAUTHENTICATED',
        message: 'Unauthenticated',
      });

    await ctx.runQuery(
      internal.websites.internal_queries.verifyOrganizationMembership,
      {
        organizationId: args.organizationId,
        userId: authUser.userId,
        email: authUser.email,
        name: authUser.name,
      },
    );

    const domain = toWebsiteDomain(args.domain);
    const isList = args.urls !== undefined && args.urls.length > 0;

    // Boundary validation for list entries: parseable, http(s), and on this
    // domain. The client splits a multi-domain paste into one call per
    // domain, so a foreign-host entry here is a caller bug, not user input
    // to soften.
    let listedUrls: string[] | undefined;
    if (isList && args.urls) {
      const hosts = siteHosts(domain);
      const normalized = new Set<string>();
      for (const entry of args.urls) {
        const url = normalizeListedUrl(entry, hosts);
        if (!url) {
          throw new ConvexError({
            code: 'WEBSITE_INVALID_LIST_URL',
            url: entry,
            domain,
          });
        }
        normalized.add(url);
      }
      listedUrls = [...normalized];
    }

    let websiteId: Id<'websites'>;
    const existing = isList
      ? await ctx.runQuery(
          internal.websites.internal_queries.getWebsiteByDomain,
          { organizationId: args.organizationId, domain },
        )
      : null;
    if (existing) {
      // Same-org re-registration of a list MERGES: the corpus upsert adds
      // the new URLs, the row just refreshes its cadence. Site mode keeps
      // the duplicate guard in `createWebsite` (#2056).
      await ctx.runMutation(internal.websites.internal_mutations.patchWebsite, {
        websiteId: existing._id,
        scanInterval: args.scanInterval,
        status: 'scanning',
      });
      websiteId = existing._id;
    } else {
      websiteId = await ctx.runMutation(
        internal.websites.internal_mutations.provisionWebsite,
        {
          organizationId: args.organizationId,
          domain: args.domain,
          kind: isList ? 'list' : undefined,
          title: args.title,
          description: args.description,
          scanInterval: args.scanInterval,
          status: 'scanning',
        },
      );
    }

    // Register with crawler asynchronously — don't block the UI
    await ctx.scheduler.runAfter(
      0,
      internal.websites.internal_actions.registerAndSync,
      {
        websiteId,
        domain,
        scanInterval: args.scanInterval,
        organizationId: args.organizationId,
        urls: listedUrls,
      },
    );

    return websiteId;
  },
});

export const deleteWebsite = action({
  args: {
    websiteId: v.id('websites'),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser)
      throw new ConvexError({
        code: 'UNAUTHENTICATED',
        message: 'Unauthenticated',
      });

    const website = await ctx.runQuery(
      internal.websites.internal_queries.getWebsite,
      { websiteId: args.websiteId },
    );
    if (!website)
      throw new ConvexError({
        code: 'WEBSITE_NOT_FOUND',
        message: 'Website not found',
      });

    await ctx.runQuery(
      internal.websites.internal_queries.verifyOrganizationMembership,
      {
        organizationId: website.organizationId,
        userId: authUser.userId,
        email: authUser.email,
        name: authUser.name,
      },
    );

    const orgSlug = await orgSlugFromId(ctx, website.organizationId);
    // Best-effort crawler deregister then delete the row: an unreachable
    // crawler must not block deletion of the website record (#2316).
    await deregisterAndDeleteWebsiteRow(
      ctx,
      args.websiteId,
      orgSlug,
      website.domain,
    );

    return null;
  },
});

export const updateWebsite = action({
  args: {
    websiteId: v.id('websites'),
    domain: v.optional(v.string()),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    // Runtime validation happens at the internal mutation chokepoint
    // (`patchWebsite`), which every write path funnels through.
    scanInterval: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser)
      throw new ConvexError({
        code: 'UNAUTHENTICATED',
        message: 'Unauthenticated',
      });

    const website = await ctx.runQuery(
      internal.websites.internal_queries.getWebsite,
      { websiteId: args.websiteId },
    );
    if (!website)
      throw new ConvexError({
        code: 'WEBSITE_NOT_FOUND',
        message: 'Website not found',
      });

    await ctx.runQuery(
      internal.websites.internal_queries.verifyOrganizationMembership,
      {
        organizationId: website.organizationId,
        userId: authUser.userId,
        email: authUser.email,
        name: authUser.name,
      },
    );

    // Sync scan interval to crawler
    if (args.scanInterval && args.scanInterval !== website.scanInterval) {
      const orgSlug = await orgSlugFromId(ctx, website.organizationId);
      try {
        await updateCrawlerScanInterval(
          ctx,
          orgSlug,
          website.domain,
          args.scanInterval,
        );
      } catch (error) {
        if (
          error instanceof ConvexError &&
          typeof error.data === 'object' &&
          error.data !== null &&
          'code' in error.data &&
          error.data.code === 'CRAWLER_WEBSITE_NOT_FOUND'
        ) {
          await ctx.runMutation(
            internal.websites.internal_mutations.patchWebsite,
            {
              websiteId: args.websiteId,
              status: 'error' as const,
              metadata: {
                ...website.metadata,
                lastSyncError:
                  'Website not found in crawler. Please delete and re-add it.',
              },
            },
          );
          throw new ConvexError({
            code: 'CRAWLER_WEBSITE_NOT_FOUND',
            message:
              'Website not found in crawler. Please delete and re-add it.',
          });
        }
        throw error;
      }
    }

    await ctx.runMutation(internal.websites.internal_mutations.patchWebsite, {
      websiteId: args.websiteId,
      domain: args.domain,
      title: args.title,
      description: args.description,
      scanInterval: args.scanInterval,
    });

    return null;
  },
});

export const syncStatuses = action({
  args: {
    organizationId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser)
      throw new ConvexError({
        code: 'UNAUTHENTICATED',
        message: 'Unauthenticated',
      });

    await ctx.runQuery(
      internal.websites.internal_queries.verifyOrganizationMembership,
      {
        organizationId: args.organizationId,
        userId: authUser.userId,
        email: authUser.email,
        name: authUser.name,
      },
    );

    await ctx.runAction(
      internal.websites.internal_actions.syncWebsiteStatuses,
      { organizationId: args.organizationId },
    );

    return null;
  },
});

export const fetchPages = action({
  args: {
    websiteId: v.id('websites'),
    offset: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    pages: v.array(
      v.object({
        url: v.string(),
        title: v.union(v.string(), v.null()),
        word_count: v.number(),
        status: v.string(),
        content_hash: v.union(v.string(), v.null()),
        last_crawled_at: v.union(v.string(), v.null()),
        discovered_at: v.union(v.string(), v.null()),
        chunks_count: v.number(),
        indexed: v.boolean(),
      }),
    ),
    total: v.number(),
    offset: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args): Promise<FetchPagesResult> => {
    const { website } = await loadOwnedWebsite(ctx, args.websiteId);

    // Debounce the crawler sync: every fetchPages call (page view, poll,
    // tab open) previously scheduled syncSingleWebsite unconditionally,
    // fanning out N concurrent crawler hits + creating a last-write-wins
    // race on the row's status field. Mirror the 1-hour throttle that
    // syncWebsiteStatuses uses via metadata.lastStatusSyncAt (round-3 P2
    // R9-P2-b).
    const SYNC_DEBOUNCE_MS = 60 * 60 * 1000;
    const lastSyncAt =
      typeof website.metadata?.lastStatusSyncAt === 'number'
        ? website.metadata.lastStatusSyncAt
        : 0;
    if (Date.now() - lastSyncAt > SYNC_DEBOUNCE_MS) {
      await ctx.scheduler.runAfter(
        0,
        internal.websites.internal_actions.syncSingleWebsite,
        {
          websiteId: args.websiteId,
          domain: website.domain,
          organizationId: website.organizationId,
        },
      );
    }

    return await ctx.runAction(
      internal.websites.internal_actions.fetchWebsitePages,
      {
        domain: website.domain,
        organizationId: website.organizationId,
        offset: args.offset,
        limit: args.limit,
      },
    );
  },
});

export const fetchChunks = action({
  args: {
    websiteId: v.id('websites'),
    url: v.string(),
  },
  handler: async (ctx, args): Promise<FetchChunksResult> => {
    const { website } = await loadOwnedWebsite(ctx, args.websiteId);

    return await ctx.runAction(
      internal.websites.internal_actions.fetchPageChunks,
      {
        domain: website.domain,
        url: args.url,
        organizationId: website.organizationId,
      },
    );
  },
});

export const searchContent = action({
  args: {
    websiteId: v.id('websites'),
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SearchContentResult> => {
    const { website } = await loadOwnedWebsite(ctx, args.websiteId);

    return await ctx.runAction(
      internal.websites.internal_actions.searchWebsiteContent,
      {
        domain: website.domain,
        query: args.query,
        organizationId: website.organizationId,
        limit: args.limit,
      },
    );
  },
});

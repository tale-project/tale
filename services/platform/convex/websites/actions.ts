import { v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import type {
  FetchChunksResult,
  FetchPagesResult,
  SearchContentResult,
} from './types';

import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import { authComponent } from '../auth';
import { toWebsiteDomain } from './create_website';
import {
  deregisterDomainFromCrawler,
  registerDomainWithCrawler,
} from './internal_actions';

export const createWebsite = action({
  args: {
    organizationId: v.string(),
    domain: v.string(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    scanInterval: v.string(),
  },
  returns: v.id('websites'),
  handler: async (ctx, args): Promise<Id<'websites'>> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    await ctx.runQuery(
      internal.websites.internal_queries.verifyOrganizationMembership,
      {
        organizationId: args.organizationId,
        userId: authUser._id,
        email: authUser.email,
        name: authUser.name,
      },
    );

    const domain = toWebsiteDomain(args.domain);

    const websiteId = await ctx.runMutation(
      internal.websites.internal_mutations.provisionWebsite,
      {
        organizationId: args.organizationId,
        domain: args.domain,
        title: args.title,
        description: args.description,
        scanInterval: args.scanInterval,
        status: 'scanning',
      },
    );

    // Register with crawler asynchronously — don't block the UI
    await ctx.scheduler.runAfter(
      0,
      internal.websites.internal_actions.registerAndSync,
      { websiteId, domain, scanInterval: args.scanInterval },
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
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const website = await ctx.runQuery(
      internal.websites.internal_queries.getWebsite,
      { websiteId: args.websiteId },
    );
    if (!website) throw new Error('Website not found');

    await ctx.runQuery(
      internal.websites.internal_queries.verifyOrganizationMembership,
      {
        organizationId: website.organizationId,
        userId: authUser._id,
        email: authUser.email,
        name: authUser.name,
      },
    );

    const domain = await ctx.runMutation(
      internal.websites.internal_mutations.deleteWebsite,
      { websiteId: args.websiteId },
    );

    // Deregister from crawler
    await deregisterDomainFromCrawler(domain);

    return null;
  },
});

export const updateWebsite = action({
  args: {
    websiteId: v.id('websites'),
    domain: v.optional(v.string()),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    scanInterval: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const website = await ctx.runQuery(
      internal.websites.internal_queries.getWebsite,
      { websiteId: args.websiteId },
    );
    if (!website) throw new Error('Website not found');

    await ctx.runQuery(
      internal.websites.internal_queries.verifyOrganizationMembership,
      {
        organizationId: website.organizationId,
        userId: authUser._id,
        email: authUser.email,
        name: authUser.name,
      },
    );

    // Sync scan interval to crawler first
    if (args.scanInterval && args.scanInterval !== website.scanInterval) {
      await registerDomainWithCrawler(website.domain, args.scanInterval);
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
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    await ctx.runQuery(
      internal.websites.internal_queries.verifyOrganizationMembership,
      {
        organizationId: args.organizationId,
        userId: authUser._id,
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
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const website = await ctx.runQuery(
      internal.websites.internal_queries.getWebsite,
      { websiteId: args.websiteId },
    );
    if (!website) throw new Error('Website not found');

    // Trigger async metadata sync from crawler
    await ctx.scheduler.runAfter(
      0,
      internal.websites.internal_actions.syncSingleWebsite,
      { websiteId: args.websiteId, domain: website.domain },
    );

    return await ctx.runAction(
      internal.websites.internal_actions.fetchWebsitePages,
      {
        domain: website.domain,
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
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const website = await ctx.runQuery(
      internal.websites.internal_queries.getWebsite,
      { websiteId: args.websiteId },
    );
    if (!website) throw new Error('Website not found');

    return await ctx.runAction(
      internal.websites.internal_actions.fetchPageChunks,
      { domain: website.domain, url: args.url },
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
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const website = await ctx.runQuery(
      internal.websites.internal_queries.getWebsite,
      { websiteId: args.websiteId },
    );
    if (!website) throw new Error('Website not found');

    return await ctx.runAction(
      internal.websites.internal_actions.searchWebsiteContent,
      { domain: website.domain, query: args.query, limit: args.limit },
    );
  },
});

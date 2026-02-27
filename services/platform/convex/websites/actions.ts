import { v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import type { FetchPagesResult } from './types';

import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import { authComponent } from '../auth';
import {
  registerDomainWithCrawler,
  deregisterDomainFromCrawler,
  fetchWebsiteInfo,
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

    const websiteId = await ctx.runMutation(
      internal.websites.internal_mutations.provisionWebsite,
      {
        organizationId: args.organizationId,
        domain: args.domain,
        title: args.title,
        description: args.description,
        scanInterval: args.scanInterval,
      },
    );

    // Register with crawler — wait for confirmation
    try {
      await registerDomainWithCrawler(args.domain, args.scanInterval);
    } catch (e) {
      await ctx.runMutation(internal.websites.internal_mutations.patchWebsite, {
        websiteId,
        status: 'error',
      });
      throw e;
    }

    // Sync page count
    const info = await fetchWebsiteInfo(args.domain);
    if (info?.page_count !== undefined) {
      await ctx.runMutation(internal.websites.internal_mutations.patchWebsite, {
        websiteId,
        pageCount: info.page_count,
      });
    }

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

export const rescanWebsite = action({
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

    const { domain, scanInterval } = await ctx.runMutation(
      internal.websites.internal_mutations.rescanWebsite,
      { websiteId: args.websiteId },
    );

    // Trigger crawler rescan — re-registering triggers scan
    try {
      await registerDomainWithCrawler(domain, scanInterval);
    } catch (e) {
      await ctx.runMutation(internal.websites.internal_mutations.patchWebsite, {
        websiteId: args.websiteId,
        status: 'error',
      });
      throw e;
    }

    // Sync page count
    const info = await fetchWebsiteInfo(domain);
    if (info?.page_count !== undefined) {
      await ctx.runMutation(internal.websites.internal_mutations.patchWebsite, {
        websiteId: args.websiteId,
        pageCount: info.page_count,
      });
    }

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
  handler: async (ctx, args): Promise<FetchPagesResult> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const website = await ctx.runQuery(
      internal.websites.internal_queries.getWebsite,
      { websiteId: args.websiteId },
    );
    if (!website) throw new Error('Website not found');

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

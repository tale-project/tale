import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';
import { getOrganizationMember } from '../lib/rls';
import * as WebsitesHelpers from './helpers';
import { listWebsitesPaginated as listWebsitesPaginatedHelper } from './list_websites_paginated';

export const getWebsite = internalQuery({
  args: {
    websiteId: v.id('websites'),
  },
  handler: async (ctx, args) => {
    return await WebsitesHelpers.getWebsite(ctx, args.websiteId);
  },
});

export const verifyOrganizationMembership = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    email: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    await getOrganizationMember(ctx, args.organizationId, {
      userId: args.userId,
      email: args.email,
      name: args.name,
    });
  },
});

export const listWebsitesForSync = internalQuery({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const results = [];
    for await (const website of ctx.db
      .query('websites')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      results.push({
        _id: website._id,
        domain: website.domain,
        pageCount: website.pageCount,
        metadata: website.metadata,
      });
    }
    return results;
  },
});

export const listWebsitesPaginated = internalQuery({
  args: {
    paginationOpts: paginationOptsValidator,
    organizationId: v.string(),
    status: v.optional(v.string()),
    scanInterval: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await listWebsitesPaginatedHelper(ctx, args);
  },
});

export const getWebsiteByDomain = internalQuery({
  args: {
    organizationId: v.string(),
    domain: v.string(),
  },
  handler: async (ctx, args) => {
    return await WebsitesHelpers.getWebsiteByDomain(ctx, args);
  },
});

/**
 * Lightweight website summaries for an organization.
 * Used by the web tool to list available websites in no-results messages.
 */
export const listWebsiteSummaries = internalQuery({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const results: Array<{
      domain: string;
      title?: string;
      description?: string;
      pageCount?: number;
    }> = [];
    const excludeStatuses = new Set(['deleting', 'error']);
    for await (const website of ctx.db
      .query('websites')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      if (website.status && excludeStatuses.has(website.status)) continue;
      results.push({
        domain: website.domain,
        title: website.title,
        description: website.description,
        pageCount: website.pageCount,
      });
    }
    return results;
  },
});

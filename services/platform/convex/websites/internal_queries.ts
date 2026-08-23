import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import * as WebsitesHelpers from './helpers';
import { scanIntervalToSeconds } from './internal_actions';
import { listWebsitesPaginated as listWebsitesPaginatedHelper } from './list_websites_paginated';
import {
  connectionFailureCount,
  lastScanAttemptAt,
  scanPausedAt,
} from './scan_scheduling';

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
    // Optional: sourced from the JWT identity (getAuthUserIdentity), where
    // email/name are optional. getOrganizationMember accepts them optionally.
    email: v.optional(v.string()),
    name: v.optional(v.string()),
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
        status: website.status,
        metadata: website.metadata,
      });
    }
    return results;
  },
});

/**
 * Every registered website, minimally projected for the crawl scheduler —
 * which crosses organizations by design: the five-minute cron sweeps the
 * whole deployment and each row names the organization whose corpus pool
 * its scan runs on.
 */
export const listWebsitesForScanScheduling = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      domain: v.string(),
      organizationId: v.string(),
      scanIntervalSeconds: v.number(),
      lastScannedAt: v.optional(v.number()),
      lastAttemptAt: v.optional(v.number()),
      status: v.optional(v.string()),
      createdAt: v.number(),
      connectionFailures: v.number(),
      scanPaused: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const websites = await ctx.db.query('websites').take(500);
    return websites.map((website) => ({
      domain: website.domain,
      organizationId: website.organizationId,
      scanIntervalSeconds: scanIntervalToSeconds(website.scanInterval),
      lastScannedAt: website.lastScannedAt,
      lastAttemptAt: lastScanAttemptAt(website.metadata) ?? undefined,
      status: website.status,
      createdAt: website._creationTime,
      connectionFailures: connectionFailureCount(website.metadata),
      scanPaused: scanPausedAt(website.metadata) !== null,
    }));
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

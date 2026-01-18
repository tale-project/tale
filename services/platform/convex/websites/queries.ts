/**
 * Websites Queries
 *
 * Internal and public queries for website operations.
 */

import { v } from 'convex/values';
import { internalQuery, query } from '../_generated/server';
import * as WebsitesHelpers from './helpers';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';
import { websiteValidator } from './validators';

/**
 * Get a website by ID (internal query)
 */
export const getWebsiteInternal = internalQuery({
  args: {
    websiteId: v.id('websites'),
  },
  handler: async (ctx, args) => {
    return await WebsitesHelpers.getWebsite(ctx, args.websiteId);
  },
});

/**
 * Get a website by domain within an organization (internal query)
 */
export const getWebsiteByDomainInternal = internalQuery({
  args: {
    organizationId: v.string(),
    domain: v.string(),
  },
  handler: async (ctx, args) => {
    return await WebsitesHelpers.getWebsiteByDomain(ctx, args);
  },
});

/**
 * Get a website page by URL (internal query)
 */
export const getWebsitePageByUrlInternal = internalQuery({
  args: {
    organizationId: v.string(),
    url: v.string(),
  },
  handler: async (ctx, args) => {
    return await WebsitesHelpers.getPageByUrl(ctx, args);
  },
});

// =============================================================================
// PUBLIC QUERIES (for frontend via api.websites.queries.*)
// =============================================================================

/**
 * Check if organization has any websites.
 */
export const hasWebsites = query({
  args: {
    organizationId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      return false;
    }

    // Verify user has access to this organization
    try {
      await getOrganizationMember(ctx, args.organizationId, {
        userId: authUser.userId ?? '',
        email: authUser.email,
        name: authUser.name,
      });
    } catch {
      return false;
    }

    const firstWebsite = await ctx.db
      .query('websites')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .first();

    return firstWebsite !== null;
  },
});

/**
 * Get all websites for an organization.
 */
export const getAllWebsites = query({
  args: {
    organizationId: v.string(),
  },
  returns: v.array(websiteValidator),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      return [];
    }

    // Verify user has access to this organization
    try {
      await getOrganizationMember(ctx, args.organizationId, {
        userId: authUser.userId ?? '',
        email: authUser.email,
        name: authUser.name,
      });
    } catch {
      return [];
    }

    const websites = [];
    for await (const website of ctx.db
      .query('websites')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      websites.push(website);
    }
    return websites;
  },
});

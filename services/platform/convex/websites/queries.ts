/**
 * Websites Queries
 *
 * Internal queries for website operations.
 */

import { v } from 'convex/values';
import { internalQuery } from '../_generated/server';
import * as WebsitesHelpers from './helpers';

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

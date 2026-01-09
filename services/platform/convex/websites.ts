/**
 * Websites API - Thin wrappers for website operations
 *
 * This file contains all public and internal Convex functions for websites.
 * Business logic is in convex/model/websites/
 */

import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { mutationWithRLS, queryWithRLS } from './lib/rls';
import {
  internalQuery,
  internalMutation,
  internalAction,
} from './_generated/server';

// Import model functions and validators
import * as WebsitesModel from './model/websites';
import {
  websiteStatusValidator,
  websiteValidator,
  websitePageValidator,
} from './model/websites/validators';

// =============================================================================
// PUBLIC OPERATIONS (with RLS)
// =============================================================================

/**
 * Get a paginated list of websites for an organization
 */
export const getWebsites = queryWithRLS({
  args: {
    organizationId: v.string(),
    paginationOpts: paginationOptsValidator,
    status: v.optional(v.array(v.string())),
    searchTerm: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await WebsitesModel.getWebsites(ctx, args);
  },
});

/**
 * Check if organization has any websites (fast count query for empty state detection)
 */
export const hasWebsites = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
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
 * Get a single website by ID
 */
export const getWebsite = queryWithRLS({
  args: {
    websiteId: v.id('websites'),
  },
  handler: async (ctx, args) => {
    return await WebsitesModel.getWebsite(ctx, args.websiteId);
  },
});

/**
 * Get a website by domain within an organization
 */
export const getWebsiteByDomain = queryWithRLS({
  args: {
    organizationId: v.string(),
    domain: v.string(),
  },
  handler: async (ctx, args) => {
    return await WebsitesModel.getWebsiteByDomain(ctx, args);
  },
});

/**
 * Create a new website
 */
export const createWebsite = mutationWithRLS({
  args: {
    organizationId: v.string(),
    domain: v.string(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    scanInterval: v.string(),
    status: v.optional(websiteStatusValidator),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    return await WebsitesModel.createWebsite(ctx, args);
  },
});

/**
 * Update an existing website
 */
export const updateWebsite = mutationWithRLS({
  args: {
    websiteId: v.id('websites'),
    domain: v.optional(v.string()),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    scanInterval: v.optional(v.string()),
    lastScannedAt: v.optional(v.number()),
    status: v.optional(websiteStatusValidator),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    return await WebsitesModel.updateWebsite(ctx, args);
  },
});

/**
 * Delete a website
 */
export const deleteWebsite = mutationWithRLS({
  args: {
    websiteId: v.id('websites'),
  },
  handler: async (ctx, args) => {
    return await WebsitesModel.deleteWebsite(ctx, args.websiteId);
  },
});

/**
 * Trigger a manual rescan of a website
 */
export const rescanWebsite = mutationWithRLS({
  args: {
    websiteId: v.id('websites'),
  },
  handler: async (ctx, args) => {
    return await WebsitesModel.rescanWebsite(ctx, args.websiteId);
  },
});

// =============================================================================
// INTERNAL OPERATIONS (without RLS)
// =============================================================================

/**
 * Create a new website (internal)
 */
export const createWebsiteInternal = internalMutation({
  args: {
    organizationId: v.string(),
    domain: v.string(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    scanInterval: v.string(),
    lastScannedAt: v.optional(v.number()),
    status: v.optional(websiteStatusValidator),
    metadata: v.optional(v.any()),
  },
  returns: v.id('websites'),
  handler: async (ctx, args) => {
    return await WebsitesModel.createWebsite(ctx, args);
  },
});

/**
 * Update an existing website (internal)
 */
export const updateWebsiteInternal = internalMutation({
  args: {
    websiteId: v.id('websites'),
    domain: v.optional(v.string()),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    scanInterval: v.optional(v.string()),
    lastScannedAt: v.optional(v.number()),
    status: v.optional(websiteStatusValidator),
    metadata: v.optional(v.any()),
  },
  returns: v.union(websiteValidator, v.null()),
  handler: async (ctx, args) => {
    return await WebsitesModel.updateWebsite(ctx, args);
  },
});

/**
 * Get a website by id (internal)
 */
export const getWebsiteInternal = internalQuery({
  args: { websiteId: v.id('websites') },
  returns: v.union(websiteValidator, v.null()),
  handler: async (ctx, args) => {
    return await WebsitesModel.getWebsite(ctx, args.websiteId);
  },
});

/**
 * Get a website by domain (internal query for workflows)
 */
export const getWebsiteByDomainInternal = internalQuery({
  args: {
    organizationId: v.string(),
    domain: v.string(),
  },
  returns: v.union(websiteValidator, v.null()),
  handler: async (ctx, args) => {
    return await WebsitesModel.getWebsiteByDomain(ctx, args);
  },
});

/**
 * Get a single website page by URL within an organization (internal).
 * Used by workflows and agent tools to reuse crawled content when available.
 */
export const getWebsitePageByUrlInternal = internalQuery({
  args: {
    organizationId: v.string(),
    url: v.string(),
  },
  returns: v.union(websitePageValidator, v.null()),
  handler: async (ctx, args) => {
    return await WebsitesModel.getPageByUrl(ctx, args);
  },
});

/**
 * Bulk upsert website pages for a website (internal, used by workflows)
 */
export const bulkUpsertPagesInternal = internalMutation({
  args: {
    organizationId: v.string(),
    websiteId: v.id('websites'),
    pages: v.array(
      v.object({
        url: v.string(),
        title: v.optional(v.string()),
        content: v.optional(v.string()),
        wordCount: v.optional(v.number()),
        metadata: v.optional(v.any()),
        structuredData: v.optional(v.any()),
      }),
    ),
  },
  returns: v.object({
    created: v.number(),
    updated: v.number(),
    total: v.number(),
  }),
  handler: async (ctx, args) => {
    return await WebsitesModel.bulkUpsertPages(ctx, args);
  },
});
/**
 * Provision and publish a Website Scan workflow for a website (background)
 */
export const provisionWebsiteScanWorkflow = internalAction({
  args: {
    organizationId: v.string(),
    websiteId: v.id('websites'),
    domain: v.string(),
    scanInterval: v.string(),
    autoTriggerInitialScan: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await WebsitesModel.provisionWebsiteScanWorkflow(ctx, args);
    return null;
  },
});

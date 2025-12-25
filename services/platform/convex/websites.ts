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
import {
  normalizePaginationOptions,
  calculatePaginationMeta,
} from './lib/pagination';
import type { Doc } from './_generated/dataModel';

// Import model functions and validators
import * as WebsitesModel from './model/websites';
import {
  websiteStatusValidator,
  websiteValidator,
  websitePageValidator,
} from './model/websites/types';

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
 * List websites with offset-based pagination, search, and filtering
 *
 * Uses offset-based pagination for traditional page navigation with total counts.
 */
export const listWebsites = queryWithRLS({
  args: {
    organizationId: v.string(),
    currentPage: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    searchTerm: v.optional(v.string()),
    status: v.optional(v.array(v.string())),
    sortField: v.optional(v.string()),
    sortOrder: v.optional(v.union(v.literal('asc'), v.literal('desc'))),
  },
  returns: v.object({
    items: v.array(v.any()),
    total: v.number(),
    page: v.number(),
    pageSize: v.number(),
    totalPages: v.number(),
    hasNextPage: v.boolean(),
    hasPreviousPage: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { page: currentPage, pageSize } = normalizePaginationOptions({
      page: args.currentPage,
      pageSize: args.pageSize,
    });

    const query = ctx.db
      .query('websites')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('desc');

    // Pre-compute filter helpers for O(1) lookups
    const statusSet =
      args.status && args.status.length > 0 ? new Set(args.status) : null;
    const searchLower = args.searchTerm?.toLowerCase();

    // Collect all matching websites
    const matchingWebsites: Doc<'websites'>[] = [];

    for await (const website of query) {
      // Apply status filter
      if (statusSet && (!website.status || !statusSet.has(website.status))) {
        continue;
      }
      // Apply search filter
      if (searchLower) {
        const domainMatch = website.domain?.toLowerCase().includes(searchLower);
        const titleMatch = website.title?.toLowerCase().includes(searchLower);
        const descriptionMatch = website.description
          ?.toLowerCase()
          .includes(searchLower);
        if (!domainMatch && !titleMatch && !descriptionMatch) {
          continue;
        }
      }
      matchingWebsites.push(website);
    }

    const total = matchingWebsites.length;
    const { totalPages, hasNextPage, hasPreviousPage } = calculatePaginationMeta(
      total,
      currentPage,
      pageSize,
    );

    // Apply sorting
    const sortField = args.sortField || '_creationTime';
    const sortOrder = args.sortOrder || 'desc';
    matchingWebsites.sort((a, b) => {
      const aVal = (a as Record<string, unknown>)[sortField];
      const bVal = (b as Record<string, unknown>)[sortField];
      if (aVal === bVal) return 0;
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      const comparison = aVal < bVal ? -1 : 1;
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    // Paginate
    const startIndex = (currentPage - 1) * pageSize;
    const items = matchingWebsites.slice(startIndex, startIndex + pageSize);

    return {
      items,
      total,
      page: currentPage,
      pageSize,
      totalPages,
      hasNextPage,
      hasPreviousPage,
    };
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

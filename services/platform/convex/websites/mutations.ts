/**
 * Websites Mutations
 *
 * Internal mutations for website operations.
 */

import { v } from 'convex/values';
import { internalMutation, internalAction } from '../_generated/server';
import { jsonValueValidator } from '../../lib/shared/schemas/utils/json-value';
import * as WebsitesHelpers from './helpers';

const websiteStatusValidator = v.union(
  v.literal('active'),
  v.literal('inactive'),
  v.literal('error'),
);

/**
 * Create a website (internal mutation for workflow engine)
 */
export const createWebsiteInternal = internalMutation({
  args: {
    organizationId: v.string(),
    domain: v.string(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    scanInterval: v.string(),
    status: v.optional(websiteStatusValidator),
    metadata: v.optional(jsonValueValidator),
  },
  handler: async (ctx, args) => {
    return await WebsitesHelpers.createWebsite(ctx, args);
  },
});

/**
 * Update a website (internal mutation)
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
    metadata: v.optional(jsonValueValidator),
  },
  handler: async (ctx, args) => {
    return await WebsitesHelpers.updateWebsite(ctx, args);
  },
});

/**
 * Bulk upsert website pages (internal mutation)
 */
export const bulkUpsertPagesInternal = internalMutation({
  args: {
    organizationId: v.string(),
    websiteId: v.string(),
    pages: v.array(
      v.object({
        url: v.string(),
        title: v.optional(v.string()),
        content: v.optional(v.string()),
        wordCount: v.optional(v.number()),
        metadata: v.optional(v.record(v.string(), jsonValueValidator)),
        structuredData: v.optional(v.record(v.string(), jsonValueValidator)),
      }),
    ),
  },
  handler: async (ctx, args) => {
    return await WebsitesHelpers.bulkUpsertPages(ctx, args);
  },
});

/**
 * Provision a website scan workflow (internal action)
 */
export const provisionWebsiteScanWorkflow = internalAction({
  args: {
    organizationId: v.string(),
    websiteId: v.id('websites'),
    domain: v.string(),
    scanInterval: v.string(),
    autoTriggerInitialScan: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    return await WebsitesHelpers.provisionWebsiteScanWorkflow(ctx, args);
  },
});

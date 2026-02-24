import { v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import { internal } from '../_generated/api';
import { internalMutation } from '../_generated/server';
import * as WebsitesHelpers from './helpers';

const websiteStatusValidator = v.union(
  v.literal('active'),
  v.literal('inactive'),
  v.literal('error'),
);

export const provisionWebsite = internalMutation({
  args: {
    organizationId: v.string(),
    domain: v.string(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    scanInterval: v.string(),
    status: v.optional(websiteStatusValidator),
    metadata: v.optional(jsonRecordValidator),
  },
  handler: async (ctx, args) => {
    return await WebsitesHelpers.createWebsite(ctx, args);
  },
});

export const patchWebsite = internalMutation({
  args: {
    websiteId: v.id('websites'),
    domain: v.optional(v.string()),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    scanInterval: v.optional(v.string()),
    lastScannedAt: v.optional(v.number()),
    status: v.optional(websiteStatusValidator),
    metadata: v.optional(jsonRecordValidator),
  },
  handler: async (ctx, args) => {
    return await WebsitesHelpers.updateWebsite(ctx, args);
  },
});

export const bulkUpsertPages = internalMutation({
  args: {
    organizationId: v.string(),
    websiteId: v.string(),
    pages: v.array(
      v.object({
        url: v.string(),
        title: v.optional(v.string()),
        content: v.optional(v.string()),
        wordCount: v.optional(v.number()),
        metadata: v.optional(jsonRecordValidator),
        structuredData: v.optional(jsonRecordValidator),
      }),
    ),
  },
  handler: async (ctx, args) => {
    return await WebsitesHelpers.bulkUpsertPages(ctx, args);
  },
});

export const registerDiscoveredUrls = internalMutation({
  args: {
    organizationId: v.string(),
    websiteId: v.string(),
    urls: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    return await WebsitesHelpers.registerDiscoveredUrls(ctx, args);
  },
});

export const markPagesSynced = internalMutation({
  args: {
    pageIds: v.array(v.id('websitePages')),
  },
  handler: async (ctx, args) => {
    return await WebsitesHelpers.markPagesSynced(ctx, args.pageIds);
  },
});

export const deletePages = internalMutation({
  args: {
    websiteId: v.id('websites'),
    pageIds: v.array(v.id('websitePages')),
  },
  handler: async (ctx, args) => {
    return await WebsitesHelpers.deletePages(ctx, args);
  },
});

export const batchCleanupWebsitePages = internalMutation({
  args: {
    websiteId: v.id('websites'),
  },
  handler: async (ctx, args) => {
    const result = await WebsitesHelpers.cleanupWebsitePagesBatch(
      ctx,
      args.websiteId,
    );

    if (result.hasMore) {
      await ctx.scheduler.runAfter(
        0,
        internal.websites.internal_mutations.batchCleanupWebsitePages,
        { websiteId: args.websiteId },
      );
    }
  },
});

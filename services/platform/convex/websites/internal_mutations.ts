import { v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import { internalMutation } from '../_generated/server';
import * as WebsitesHelpers from './helpers';

const websiteStatusValidator = v.union(
  v.literal('idle'),
  v.literal('scanning'),
  v.literal('active'),
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

export const deleteWebsite = internalMutation({
  args: {
    websiteId: v.id('websites'),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    return await WebsitesHelpers.deleteWebsite(ctx, args.websiteId);
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
    pageCount: v.optional(v.number()),
    crawledPageCount: v.optional(v.number()),
    metadata: v.optional(jsonRecordValidator),
  },
  handler: async (ctx, args) => {
    return await WebsitesHelpers.updateWebsite(ctx, args);
  },
});

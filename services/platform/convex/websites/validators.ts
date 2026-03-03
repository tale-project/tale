/**
 * Convex validators for website operations
 */

import { v } from 'convex/values';

import { jsonRecordValidator } from '../lib/validators/json';

export const websiteStatusValidator = v.union(
  v.literal('idle'),
  v.literal('scanning'),
  v.literal('active'),
  v.literal('error'),
  v.literal('deleting'),
);

export const websiteValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  organizationId: v.string(),
  domain: v.string(),
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  scanInterval: v.string(),
  lastScannedAt: v.optional(v.number()),
  status: v.optional(websiteStatusValidator),
  pageCount: v.optional(v.number()),
  crawledPageCount: v.optional(v.number()),
  metadata: v.optional(jsonRecordValidator),
});

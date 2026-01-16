/**
 * Convex validators for website operations
 */

import { v } from 'convex/values';
import { jsonRecordValidator } from '../../../lib/shared/validators/utils/json-value';

/**
 * Website status validator
 */
export const websiteStatusValidator = v.union(
  v.literal('active'),
  v.literal('inactive'),
  v.literal('error'),
);

/**
 * Website document validator (matches schema)
 */
export const websiteValidator = v.object({
  _id: v.id('websites'),
  _creationTime: v.number(),
  organizationId: v.string(),
  domain: v.string(),
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  scanInterval: v.string(),
  lastScannedAt: v.optional(v.number()),
  status: v.optional(websiteStatusValidator),
  metadata: v.optional(jsonRecordValidator),
});

/**
 * Website page document validator (matches schema)
 */
export const websitePageValidator = v.object({
  _id: v.id('websitePages'),
  _creationTime: v.number(),
  organizationId: v.string(),
  websiteId: v.id('websites'),
  url: v.string(),
  title: v.optional(v.string()),
  content: v.optional(v.string()),
  wordCount: v.optional(v.number()),
  lastCrawledAt: v.number(),
  metadata: v.optional(jsonRecordValidator),
  structuredData: v.optional(jsonRecordValidator),
});

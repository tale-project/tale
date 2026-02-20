import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

export const websitesTable = defineTable({
  organizationId: v.string(),
  domain: v.string(),
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  scanInterval: v.string(),
  lastScannedAt: v.optional(v.number()),
  status: v.optional(
    v.union(v.literal('active'), v.literal('inactive'), v.literal('error')),
  ),
  pageCount: v.optional(v.number()),
  metadata: v.optional(jsonRecordValidator),
})
  .index('by_organizationId', ['organizationId'])
  .index('by_organizationId_and_status', ['organizationId', 'status'])
  .index('by_organizationId_and_domain', ['organizationId', 'domain']);

export const websitePagesTable = defineTable({
  organizationId: v.string(),
  websiteId: v.id('websites'),
  url: v.string(),
  title: v.optional(v.string()),
  content: v.optional(v.string()),
  wordCount: v.optional(v.number()),
  lastCrawledAt: v.number(),
  metadata: v.optional(jsonRecordValidator),
  structuredData: v.optional(jsonRecordValidator),
})
  .index('by_organizationId', ['organizationId'])
  .index('by_websiteId', ['websiteId'])
  .index('by_websiteId_and_lastCrawledAt', ['websiteId', 'lastCrawledAt'])
  .index('by_organizationId_and_url', ['organizationId', 'url']);

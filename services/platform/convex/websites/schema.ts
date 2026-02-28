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
    v.union(
      v.literal('idle'),
      v.literal('scanning'),
      v.literal('active'),
      v.literal('error'),
      v.literal('deleting'),
    ),
  ),
  pageCount: v.optional(v.number()),
  crawledPageCount: v.optional(v.number()),
  metadata: v.optional(jsonRecordValidator),
})
  .index('by_organizationId', ['organizationId'])
  .index('by_organizationId_and_status', ['organizationId', 'status'])
  .index('by_organizationId_and_domain', ['organizationId', 'domain']);

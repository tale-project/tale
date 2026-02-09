import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

export const productsTable = defineTable({
  organizationId: v.string(),
  name: v.string(),
  description: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  stock: v.optional(v.number()),
  price: v.optional(v.number()),
  currency: v.optional(v.string()),
  category: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  status: v.optional(
    v.union(
      v.literal('active'),
      v.literal('inactive'),
      v.literal('draft'),
      v.literal('archived'),
    ),
  ),
  translations: v.optional(
    v.array(
      v.object({
        language: v.string(),
        name: v.optional(v.string()),
        description: v.optional(v.string()),
        category: v.optional(v.string()),
        tags: v.optional(v.array(v.string())),
        metadata: v.optional(jsonRecordValidator),
        createdAt: v.optional(v.number()),
        lastUpdated: v.number(),
      }),
    ),
  ),
  lastUpdated: v.optional(v.number()),
  externalId: v.optional(v.union(v.string(), v.number())),
  metadata: v.optional(jsonRecordValidator),
})
  .index('by_organizationId', ['organizationId'])
  .index('by_organizationId_and_status', ['organizationId', 'status'])
  .index('by_organizationId_and_category', ['organizationId', 'category'])
  .index('by_organizationId_and_externalId', ['organizationId', 'externalId'])
  .index('by_org_status_lastUpdated', [
    'organizationId',
    'status',
    'lastUpdated',
  ])
  .index('by_org_lastUpdated', ['organizationId', 'lastUpdated'])
  .searchIndex('search_products', {
    searchField: 'name',
    filterFields: ['organizationId', 'status', 'category'],
  });

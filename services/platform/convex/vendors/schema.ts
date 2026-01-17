import { defineTable } from 'convex/server';
import { v } from 'convex/values';
import { dataSourceValidator } from '../lib/validators/common';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

export const vendorsTable = defineTable({
  organizationId: v.string(),
  name: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  externalId: v.optional(v.union(v.string(), v.number())),
  source: dataSourceValidator,
  locale: v.optional(v.string()),
  address: v.optional(
    v.object({
      street: v.optional(v.string()),
      city: v.optional(v.string()),
      state: v.optional(v.string()),
      country: v.optional(v.string()),
      postalCode: v.optional(v.string()),
    }),
  ),
  tags: v.optional(v.array(v.string())),
  metadata: v.optional(jsonRecordValidator),
  notes: v.optional(v.string()),
})
  .index('by_organizationId', ['organizationId'])
  .index('by_organizationId_and_email', ['organizationId', 'email'])
  .index('by_organizationId_and_externalId', ['organizationId', 'externalId'])
  .index('by_organizationId_and_source', ['organizationId', 'source'])
  .index('by_organizationId_and_locale', ['organizationId', 'locale']);

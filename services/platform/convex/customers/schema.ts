import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import { dataSourceValidator } from '../lib/validators/common';

export const customersTable = defineTable({
  organizationId: v.string(),
  name: v.optional(v.string()),
  email: v.optional(v.string()),
  externalId: v.optional(v.union(v.string(), v.number())),
  status: v.optional(
    v.union(v.literal('active'), v.literal('churned'), v.literal('potential')),
  ),
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
  metadata: v.optional(jsonRecordValidator),
})
  .index('by_organizationId', ['organizationId'])
  .index('by_organizationId_and_email', ['organizationId', 'email'])
  .index('by_organizationId_and_externalId', ['organizationId', 'externalId'])
  .index('by_organizationId_and_status', ['organizationId', 'status'])
  .index('by_organizationId_and_source', ['organizationId', 'source'])
  .index('by_organizationId_and_locale', ['organizationId', 'locale'])
  .searchIndex('search_customers', {
    searchField: 'name',
    filterFields: ['organizationId', 'status'],
  });

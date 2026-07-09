import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { lifecycleStatusValidator } from '../governance/soft_delete_validators';
import { dataSourceValidator } from '../lib/validators/common';
import { jsonRecordValidator } from '../lib/validators/json';

/**
 * Contacts — the single per-org directory of people/organizations the org
 * corresponds with (issue #2618). Replaces the former `customers` + `vendors`
 * tables, which were near-identical address books distinguished only by a
 * never-consumed `status` enum (customers) and three extra fields (vendors).
 *
 * The shape is flat and type-less by design: a contact is a contact, and any
 * contact can be a conversation correspondent. Fields are the union of the two
 * legacy tables minus the customer-only `status` enum.
 */
export const contactsTable = defineTable({
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
  lifecycleStatus: v.optional(lifecycleStatusValidator),
  statusChangedAt: v.optional(v.number()),
})
  .index('by_organizationId', ['organizationId'])
  .index('by_organizationId_and_lifecycleStatus', [
    'organizationId',
    'lifecycleStatus',
  ])
  .index('by_organizationId_and_email', ['organizationId', 'email'])
  .index('by_organizationId_and_externalId', ['organizationId', 'externalId'])
  .index('by_organizationId_and_source', ['organizationId', 'source'])
  .index('by_organizationId_and_locale', ['organizationId', 'locale']);

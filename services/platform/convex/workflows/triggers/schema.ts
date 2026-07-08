import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/validators/json';

export const wfSchedulesTable = defineTable({
  organizationId: v.string(),
  /**
   * Project this schedule belongs to, for a `scope: 'project'` app whose config
   * (and therefore schedule `variables`, e.g. the GitHub owner/repo) is
   * per-project: one schedule per bound project so two projects targeting two
   * repos never share a single org-wide schedule. Absent (undefined) for
   * org-level schedules (org-scoped apps + legacy rows predating per-project
   * config). Used only for lifecycle — create at bind, delete at unbind, sync the
   * right project in `setAutomationConfig` — by filtering, mirroring the existing
   * `organizationId` filter; the firing path is unchanged (it reads `variables`).
   */
  projectId: v.optional(v.id('projects')),
  workflowSlug: v.optional(v.string()),
  cronExpression: v.string(),
  timezone: v.string(),
  isActive: v.boolean(),
  lastTriggeredAt: v.optional(v.number()),
  createdAt: v.number(),
  createdBy: v.string(),
  variables: v.optional(jsonRecordValidator),
})
  .index('by_org', ['organizationId'])
  .index('by_workflowSlug', ['workflowSlug'])
  .index('by_org_active', ['organizationId', 'isActive']);

export const wfWebhooksTable = defineTable({
  organizationId: v.string(),
  workflowSlug: v.optional(v.string()),
  token: v.string(),
  isActive: v.boolean(),
  lastTriggeredAt: v.optional(v.number()),
  createdAt: v.number(),
  createdBy: v.string(),
})
  .index('by_org', ['organizationId'])
  .index('by_workflowSlug', ['workflowSlug'])
  .index('by_token', ['token']);

export const wfApiKeysTable = defineTable({
  organizationId: v.string(),
  workflowSlug: v.optional(v.string()),
  name: v.string(),
  keyHash: v.string(),
  keyPrefix: v.string(),
  isActive: v.boolean(),
  expiresAt: v.optional(v.number()),
  createdAt: v.number(),
  createdBy: v.string(),
})
  .index('by_org', ['organizationId'])
  .index('by_workflowSlug', ['workflowSlug'])
  .index('by_keyHash', ['keyHash']);

export const wfEventSubscriptionsTable = defineTable({
  organizationId: v.string(),
  workflowSlug: v.optional(v.string()),
  eventType: v.string(),
  eventFilter: v.optional(v.record(v.string(), v.string())),
  isActive: v.boolean(),
  lastTriggeredAt: v.optional(v.number()),
  createdAt: v.number(),
  createdBy: v.string(),
})
  .index('by_org', ['organizationId'])
  .index('by_workflowSlug', ['workflowSlug'])
  .index('by_org_eventType', ['organizationId', 'eventType']);

export const wfTriggerLogsTable = defineTable({
  organizationId: v.string(),
  workflowSlug: v.optional(v.string()),
  wfDefinitionId: v.optional(v.string()),
  wfExecutionId: v.optional(v.id('wfExecutions')),
  triggerType: v.union(
    v.literal('manual'),
    v.literal('schedule'),
    v.literal('webhook'),
    v.literal('api'),
    v.literal('event'),
  ),
  status: v.union(
    v.literal('accepted'),
    v.literal('rejected'),
    v.literal('duplicate'),
    v.literal('rate_limited'),
  ),
  idempotencyKey: v.optional(v.string()),
  ipAddress: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
  receivedAt: v.number(),
})
  .index('by_org', ['organizationId'])
  .index('by_workflowSlug', ['workflowSlug'])
  .index('by_idempotencyKey', ['organizationId', 'idempotencyKey']);

import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const wfSchedulesTable = defineTable({
  organizationId: v.string(),
  workflowRootId: v.id('wfDefinitions'),
  cronExpression: v.string(),
  timezone: v.string(),
  isActive: v.boolean(),
  lastTriggeredAt: v.optional(v.number()),
  createdAt: v.number(),
  createdBy: v.string(),
})
  .index('by_org', ['organizationId'])
  .index('by_workflowRoot', ['workflowRootId'])
  .index('by_org_active', ['organizationId', 'isActive']);

export const wfWebhooksTable = defineTable({
  organizationId: v.string(),
  workflowRootId: v.id('wfDefinitions'),
  token: v.string(),
  isActive: v.boolean(),
  lastTriggeredAt: v.optional(v.number()),
  createdAt: v.number(),
  createdBy: v.string(),
})
  .index('by_org', ['organizationId'])
  .index('by_workflowRoot', ['workflowRootId'])
  .index('by_token', ['token']);

export const wfApiKeysTable = defineTable({
  organizationId: v.string(),
  workflowRootId: v.id('wfDefinitions'),
  name: v.string(),
  keyHash: v.string(),
  keyPrefix: v.string(),
  isActive: v.boolean(),
  expiresAt: v.optional(v.number()),
  createdAt: v.number(),
  createdBy: v.string(),
})
  .index('by_org', ['organizationId'])
  .index('by_workflowRoot', ['workflowRootId'])
  .index('by_keyHash', ['keyHash']);

export const wfEventSubscriptionsTable = defineTable({
  organizationId: v.string(),
  workflowRootId: v.id('wfDefinitions'),
  eventType: v.string(),
  eventFilter: v.optional(v.record(v.string(), v.string())),
  isActive: v.boolean(),
  lastTriggeredAt: v.optional(v.number()),
  createdAt: v.number(),
  createdBy: v.string(),
})
  .index('by_org', ['organizationId'])
  .index('by_workflowRoot', ['workflowRootId'])
  .index('by_org_eventType', ['organizationId', 'eventType']);

export const wfTriggerLogsTable = defineTable({
  organizationId: v.string(),
  workflowRootId: v.id('wfDefinitions'),
  wfDefinitionId: v.id('wfDefinitions'),
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
  .index('by_workflowRoot', ['workflowRootId'])
  .index('by_idempotencyKey', ['organizationId', 'idempotencyKey']);

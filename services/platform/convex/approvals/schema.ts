import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonRecordValidator } from '../lib/validators/json';

export const approvalsTable = defineTable({
  organizationId: v.string(),
  wfExecutionId: v.optional(v.id('wfExecutions')),
  stepSlug: v.optional(v.string()),
  status: v.union(
    v.literal('pending'),
    v.literal('executing'),
    v.literal('completed'),
    v.literal('rejected'),
  ),
  approvedBy: v.optional(v.string()),
  reviewedAt: v.optional(v.number()),
  resourceType: v.union(
    v.literal('conversations'),
    v.literal('connector_operation'),
    v.literal('workflow_creation'),
    v.literal('workflow_run'),
    v.literal('workflow_update'),
    v.literal('human_input_request'),
    v.literal('document_write'),
    v.literal('knowledge_write'),
    v.literal('location_request'),
    v.literal('mcp_tool_call'),
    // GDPR Art 17 erasure request awaiting dual-admin approval. Used when
    // `dsar_governance.requireDualApproval` is enabled at the org level.
    v.literal('erasure'),
    // Task-ops review gate: agent work parked at in_review awaiting a human
    // approve / request-changes decision. resourceId = String(taskId).
    v.literal('task_review'),
    // External-agent (Claude Code) plan proposal awaiting the user's
    // approve-and-execute in chat (plan/act workflow).
    v.literal('external_agent_plan'),
    // External-agent browser handoff: the agent called request_human_control
    // and parked its turn; a human takes control of the live browser (CAPTCHA/
    // login/2FA) and returns it to resume the same session. resourceId =
    // threadId. metadata carries reason + the single-controller control lease.
    v.literal('external_agent_human_control'),
    // Operator-input marker: a run parked to ask the operator a question it
    // answers on the task timeline (comment loop) — NOT via an approval card
    // (no metadata.fields, nothing renders it). Its only job is to light the
    // "Needs your input" run indicator; keyed to wfExecutionId so it clears
    // when a newer run supersedes it. resourceId = String(taskId).
    v.literal('operator_input'),
  ),
  resourceId: v.string(),
  threadId: v.optional(v.string()),
  messageId: v.optional(v.string()),
  priority: v.union(
    v.literal('low'),
    v.literal('medium'),
    v.literal('high'),
    v.literal('urgent'),
  ),
  dueDate: v.optional(v.number()),
  executedAt: v.optional(v.number()),
  executionError: v.optional(v.string()),
  metadata: v.optional(jsonRecordValidator),
})
  .index('by_organizationId', ['organizationId'])
  .index('by_execution', ['wfExecutionId'])
  .index('by_org_status', ['organizationId', 'status'])
  .index('by_org_status_resourceType', [
    'organizationId',
    'status',
    'resourceType',
  ])
  .index('by_org_resourceType', ['organizationId', 'resourceType'])
  .index('by_resource', ['resourceType', 'resourceId'])
  .index('by_resourceType_and_resourceId_and_status', [
    'resourceType',
    'resourceId',
    'status',
  ])
  .index('by_threadId_status_resourceType', [
    'threadId',
    'status',
    'resourceType',
  ])
  .index('by_threadId', ['threadId']);

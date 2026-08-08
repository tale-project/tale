/**
 * Convex validators for approval operations
 *
 * Uses native Convex v.* validators to avoid pulling zod into the query bundle.
 * Zod schemas for client-side validation live in lib/shared/schemas/approvals.ts.
 */

import { v } from 'convex/values';

export const approvalStatusValidator = v.union(
  v.literal('pending'),
  v.literal('executing'),
  v.literal('completed'),
  v.literal('rejected'),
);

export const approvalPriorityValidator = v.union(
  v.literal('low'),
  v.literal('medium'),
  v.literal('high'),
  v.literal('urgent'),
);

export const approvalResourceTypeValidator = v.union(
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
  // Controlled-record review gate: a document record submitted for review
  // (documents/records.ts). resourceId = String(documentId); respondable
  // ONLY via respondToDocumentRecordReview — updateApprovalStatus refuses.
  v.literal('document_record_review'),
  // External-agent (Claude Code) plan proposal awaiting the user's
  // approve-and-execute in chat (plan/act workflow).
  v.literal('external_agent_plan'),
  // External-agent browser handoff: the agent parked its turn to let a human
  // drive the live browser (CAPTCHA/login/2FA); returning control resumes it.
  v.literal('external_agent_human_control'),
  // Operator-input marker: a run parked to ask the operator a question it
  // answers on the task timeline (comment loop), not via an approval card.
  // Lights the "Needs your input" run indicator; keyed to the execution so it
  // clears when a newer run supersedes it. resourceId = String(taskId).
  v.literal('operator_input'),
);

export const approvalItemValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  organizationId: v.string(),
  wfExecutionId: v.optional(v.string()),
  stepSlug: v.optional(v.string()),
  status: approvalStatusValidator,
  approvedBy: v.optional(v.string()),
  reviewedAt: v.optional(v.number()),
  resourceType: approvalResourceTypeValidator,
  resourceId: v.string(),
  priority: approvalPriorityValidator,
  dueDate: v.optional(v.number()),
  executedAt: v.optional(v.number()),
  executionError: v.optional(v.string()),
  metadata: v.optional(v.any()),
  threadId: v.optional(v.string()),
  messageId: v.optional(v.string()),
});

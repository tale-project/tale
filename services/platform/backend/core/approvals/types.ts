/**
 * Approval-operation vocabulary. Zod schemas for client-side validation live
 * in lib/shared/schemas/approvals.ts.
 */

export type ApprovalStatus = 'pending' | 'executing' | 'completed' | 'rejected';

export type ApprovalPriority = 'low' | 'medium' | 'high' | 'urgent';

export type ApprovalResourceType =
  | 'conversations'
  | 'connector_operation'
  | 'workflow_creation'
  | 'workflow_run'
  | 'workflow_update'
  | 'human_input_request'
  | 'document_write'
  | 'knowledge_write'
  | 'location_request'
  | 'mcp_tool_call'
  // GDPR Art 17 erasure request awaiting dual-admin approval. Used when
  // `dsar_governance.requireDualApproval` is enabled at the org level.
  | 'erasure'
  // Task-ops review gate: agent work parked at in_review awaiting a human
  // approve / request-changes decision. resourceId = String(taskId).
  | 'task_review'
  // Controlled-record review gate: a document record submitted for review
  // (documents/records.ts). resourceId = String(documentId); respondable
  // ONLY via respondToDocumentRecordReview — updateApprovalStatus refuses.
  | 'document_record_review'
  // External-agent (Claude Code) plan proposal awaiting the user's
  // approve-and-execute in chat (plan/act workflow).
  | 'external_agent_plan'
  // External-agent browser handoff: the agent parked its turn to let a human
  // drive the live browser (CAPTCHA/login/2FA); returning control resumes it.
  | 'external_agent_human_control'
  // Operator-input marker: a run parked to ask the operator a question it
  // answers on the task timeline (comment loop), not via an approval card.
  // Lights the "Needs your input" run indicator; keyed to the execution so it
  // clears when a newer run supersedes it. resourceId = String(taskId).
  | 'operator_input';

export interface ApprovalItem {
  _id: string;
  _creationTime: number;
  organizationId: string;
  wfExecutionId?: string;
  stepSlug?: string;
  status: ApprovalStatus;
  approvedBy?: string;
  reviewedAt?: number;
  resourceType: ApprovalResourceType;
  resourceId: string;
  priority: ApprovalPriority;
  dueDate?: number;
  executedAt?: number;
  executionError?: string;
  metadata?: Record<string, unknown>;
  threadId?: string;
  messageId?: string;
}

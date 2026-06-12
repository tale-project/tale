import type { Infer } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import {
  approvalItemValidator,
  approvalPriorityValidator,
  approvalResourceTypeValidator,
  approvalStatusValidator,
} from './validators';

export type ApprovalStatus = Infer<typeof approvalStatusValidator>;
export type ApprovalPriority = Infer<typeof approvalPriorityValidator>;
export type ApprovalResourceType = Infer<typeof approvalResourceTypeValidator>;
export type ApprovalItem = Infer<typeof approvalItemValidator>;

export interface IntegrationOperationMetadata {
  integrationId: string;
  integrationName: string;
  integrationType: 'sql' | 'rest_api';
  operationName: string;
  operationTitle: string;
  operationType: 'read' | 'write';
  parameters: Record<string, unknown>;
  previewData?: unknown[];
  estimatedImpact?: string;
  requestedAt: number;
  executedAt?: number;
  executionResult?: unknown;
}

export interface WorkflowCreationMetadata {
  workflowName: string;
  workflowSlug?: string;
  workflowDescription?: string;
  workflowConfig: {
    name: string;
    description?: string;
    version?: string;
    workflowType?: 'predefined';
    config?: Record<string, unknown>;
  };
  stepsConfig: Array<{
    stepSlug: string;
    name: string;
    stepType: Doc<'wfStepDefs'>['stepType'];
    config: Record<string, unknown>;
    nextSteps: Record<string, string>;
  }>;
  requestedAt: number;
  executedAt?: number;
  createdWorkflowSlug?: string;
  executionError?: string;
}

export interface StepPatchEntry {
  stepSlug: string;
  stepName: string;
  stepUpdates: {
    name?: string;
    stepType?: string;
    config?: Record<string, unknown>;
    nextSteps?: Record<string, string>;
  };
}

export interface WorkflowUpdateMetadata {
  updateType: 'full_save' | 'step_patch' | 'multi_step_patch';
  updateSummary: string;
  workflowSlug: string;
  workflowName: string;
  workflowVersion: string;
  workflowConfig?: {
    name: string;
    description?: string;
    version?: string;
    workflowType?: 'predefined';
    config?: Record<string, unknown>;
  };
  stepsConfig?: Array<{
    stepSlug: string;
    name: string;
    stepType: Doc<'wfStepDefs'>['stepType'];
    config: Record<string, unknown>;
    nextSteps: Record<string, string>;
  }>;
  stepSlug?: string;
  stepName?: string;
  stepUpdates?: {
    name?: string;
    stepType?: string;
    config?: Record<string, unknown>;
    nextSteps?: Record<string, string>;
  };
  steps?: StepPatchEntry[];
  requestedAt: number;
  executedAt?: number;
  executionError?: string;
}

export interface WorkflowRunMetadata {
  workflowSlug: string;
  workflowName: string;
  workflowDescription?: string;
  parameters?: Record<string, unknown>;
  requestedAt: number;
  executedAt?: number;
  executionId?: string;
  executionError?: string;
}

export interface DocumentWriteFileEntry {
  fileId: string;
  fileName: string;
  title: string;
  mimeType: string;
  fileSize: number;
  createdDocumentId?: string;
  executionError?: string;
}

export interface DocumentWriteMetadata {
  files: DocumentWriteFileEntry[];
  folderPath?: string;
  requestedAt: number;
  executedAt?: number;
  // Legacy single-file fields (present on old records only)
  fileId?: string;
  fileName?: string;
  title?: string;
  mimeType?: string;
  fileSize?: number;
  createdDocumentId?: string;
  executionError?: string;
}

/** Metadata of an `external_agent_plan` approval (plan/act workflow). The
 * plan markdown lives here so the chat card can render it in full. */
export interface PlanApprovalMetadata {
  /** Full plan markdown, exactly as the agent proposed it. */
  plan: string;
  /** Where the plan text came from: the ExitPlanMode tool input (primary) or
   * the plan-mode turn's final message (fallback). */
  planSource: 'exit_plan_mode' | 'final_text';
  /** Agent slug recorded at proposal time — approval starts the act turn
   * under THIS agent even if the composer was switched meanwhile. */
  agentSlug: string;
  modelRef: string;
  requestedAt: number;
  requestedBy?: string;
  /** Set on a pending row that a newer plan replaced (auto-rejected). */
  supersededBy?: string;
}

export function normalizeDocumentWriteMetadata(
  raw: DocumentWriteMetadata,
): DocumentWriteMetadata {
  if (raw.files?.length) return raw;
  return {
    files: [
      {
        fileId: raw.fileId ?? '',
        fileName: raw.fileName ?? '',
        title: raw.title ?? '',
        mimeType: raw.mimeType ?? '',
        fileSize: raw.fileSize ?? 0,
        createdDocumentId: raw.createdDocumentId,
        executionError: raw.executionError,
      },
    ],
    folderPath: raw.folderPath,
    requestedAt: raw.requestedAt,
    executedAt: raw.executedAt,
  };
}

export interface KnowledgeWriteMetadata {
  topic: string;
  topicKey: string;
  content: string;
  /** What the agent believes is outdated/incorrect (free-form, optional). */
  incorrectInfo?: string;
  /** Active entry this write will supersede (topic-keyed upsert). */
  replacesEntryId?: string;
  replacesTopic?: string;
  requestedAt: number;
  executedAt?: number;
  /** Set after execution. */
  entryId?: string;
  documentId?: string;
  executionError?: string;
}

export interface CreateApprovalArgs {
  organizationId: string;
  resourceType: ApprovalResourceType;
  resourceId: string;
  priority: ApprovalPriority;
  requestedBy?: string;
  dueDate?: number;
  description?: string;
  wfExecutionId?: Id<'wfExecutions'>;
  stepSlug?: string;
  metadata?: unknown;
  threadId?: string;
  messageId?: string;
}

export interface UpdateApprovalStatusArgs {
  approvalId: Id<'approvals'>;
  status: ApprovalStatus;
  approvedBy: string;
  comments?: string;
}

export interface GetApprovalHistoryArgs {
  resourceType: ApprovalResourceType;
  resourceId: string;
}

export interface ListPendingApprovalsArgs {
  organizationId: string;
  resourceType?: ApprovalResourceType;
  limit?: number;
}

export interface ListApprovalsByOrganizationArgs {
  organizationId: string;
  status?: ApprovalStatus;
  resourceType?: string | string[];
  search?: string;
  limit?: number;
}

export interface RemoveRecommendedProductArgs {
  approvalId: Id<'approvals'>;
  productId: string;
}

export interface LinkApprovalsToMessageArgs {
  threadId: string;
  messageId: string;
}

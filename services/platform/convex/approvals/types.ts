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

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
    order: number;
    config: Record<string, unknown>;
    nextSteps: Record<string, string>;
  }>;
  requestedAt: number;
  executedAt?: number;
  createdWorkflowId?: string;
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

/**
 * Workflow Execution Types and Validators
 */

import { v } from 'convex/values';
import type { Doc, Id } from '../../_generated/dataModel';

// =============================================================================
// TypeScript Types
// =============================================================================

export type WorkflowExecution = Doc<'wfExecutions'>;
export type ExecutionStatus = WorkflowExecution['status'];
export type ExecutionVariables = Record<string, unknown>;

export interface DeserializedWorkflowExecution
  extends Omit<
    WorkflowExecution,
    'workflowConfig' | 'stepsConfig' | 'variables'
  > {
  workflowConfig: unknown;
  stepsConfig: Record<string, unknown>;
  variables: ExecutionVariables;
}

export interface UpdateExecutionStatusArgs {
  executionId: Doc<'wfExecutions'>['_id'];
  status: string;
  currentStepSlug?: string;
  waitingFor?: string;
  error?: string;
}

export interface CompleteExecutionArgs {
  executionId: Doc<'wfExecutions'>['_id'];
  output: unknown;
  variablesSerialized?: string;
  variablesStorageId?: Id<'_storage'>;
}

export interface FailExecutionArgs {
  executionId: Doc<'wfExecutions'>['_id'];
  error: string;
}

export interface PatchExecutionArgs {
  executionId: Doc<'wfExecutions'>['_id'];
  updates: {
    threadId?: string;
    currentStepSlug?: string;
    variables?: string;
    metadata?: string;
  };
}

export interface ResumeExecutionArgs {
  executionId: Doc<'wfExecutions'>['_id'];
  variablesSerialized?: string;
  variablesStorageId?: Id<'_storage'>;
  metadata?: Record<string, unknown>;
}

export interface SetComponentWorkflowArgs {
  executionId: Doc<'wfExecutions'>['_id'];
  componentWorkflowId: string;
}

export interface UpdateExecutionMetadataArgs {
  executionId: Doc<'wfExecutions'>['_id'];
  metadata: Record<string, unknown>;
}

export interface UpdateExecutionVariablesArgs {
  executionId: Doc<'wfExecutions'>['_id'];
  // Must be pre-serialized in an action using internal.file.serializeVariables
  variablesSerialized?: string;
  variablesStorageId?: Id<'_storage'>;
}

export interface ListExecutionsArgs {
  wfDefinitionId: Doc<'wfDefinitions'>['_id'];
  status?: string;
  limit?: number;
  search?: string;
  triggeredBy?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface ListExecutionsPaginatedArgs {
  wfDefinitionId: Doc<'wfDefinitions'>['_id'];
  currentPage?: number;
  pageSize?: number;
  searchTerm?: string;
  status?: string[];
  triggeredBy?: string[];
  dateFrom?: string;
  dateTo?: string;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedExecutionsResult {
  items: WorkflowExecution[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

// =============================================================================
// Convex Validators
// =============================================================================

export const updateExecutionStatusArgsValidator = {
  executionId: v.id('wfExecutions'),
  status: v.string(),
  currentStepSlug: v.optional(v.string()),
  waitingFor: v.optional(v.string()),
  error: v.optional(v.string()),
};

export const completeExecutionArgsValidator = {
  executionId: v.id('wfExecutions'),
  output: v.any(),
  variablesSerialized: v.optional(v.string()),
  variablesStorageId: v.optional(v.id('_storage')),
};

export const failExecutionArgsValidator = {
  executionId: v.id('wfExecutions'),
  error: v.string(),
};

export const patchExecutionArgsValidator = {
  executionId: v.id('wfExecutions'),
  updates: v.object({
    threadId: v.optional(v.string()),
    currentStepSlug: v.optional(v.string()),
    variables: v.optional(v.string()),
    metadata: v.optional(v.string()),
  }),
};

export const resumeExecutionArgsValidator = {
  executionId: v.id('wfExecutions'),
  variablesSerialized: v.optional(v.string()),
  variablesStorageId: v.optional(v.id('_storage')),
  metadata: v.optional(v.record(v.string(), v.any())),
};

export const setComponentWorkflowArgsValidator = {
  executionId: v.id('wfExecutions'),
  componentWorkflowId: v.string(),
};

export const updateExecutionMetadataArgsValidator = {
  executionId: v.id('wfExecutions'),
  metadata: v.record(v.string(), v.any()),
};

export const updateExecutionVariablesArgsValidator = {
  executionId: v.id('wfExecutions'),
  variablesSerialized: v.optional(v.string()),
  variablesStorageId: v.optional(v.id('_storage')),
};

export const listExecutionsArgsValidator = {
  wfDefinitionId: v.id('wfDefinitions'),
  status: v.optional(v.string()),
  limit: v.optional(v.number()),
  search: v.optional(v.string()),
  triggeredBy: v.optional(v.string()),
  dateFrom: v.optional(v.string()),
  dateTo: v.optional(v.string()),
};

export const listExecutionsPaginatedArgsValidator = {
  wfDefinitionId: v.id('wfDefinitions'),
  currentPage: v.optional(v.number()),
  pageSize: v.optional(v.number()),
  searchTerm: v.optional(v.string()),
  status: v.optional(v.array(v.string())),
  triggeredBy: v.optional(v.array(v.string())),
  dateFrom: v.optional(v.string()),
  dateTo: v.optional(v.string()),
  sortField: v.optional(v.string()),
  sortOrder: v.optional(v.union(v.literal('asc'), v.literal('desc'))),
};

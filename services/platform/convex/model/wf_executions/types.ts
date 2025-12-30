/**
 * Type definitions for workflow executions
 */

import type { Doc, Id } from '../../_generated/dataModel';

// =============================================================================
// MANUAL TYPES (these rely on Doc types, not validators)
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

/**
 * Convex validators for workflow executions
 */

import { v } from 'convex/values';
import { jsonRecordValidator, jsonValueValidator } from '../../../lib/shared/validators/utils/json-value';

export const updateExecutionStatusArgsValidator = {
  executionId: v.id('wfExecutions'),
  status: v.string(),
  currentStepSlug: v.optional(v.string()),
  waitingFor: v.optional(v.string()),
  error: v.optional(v.string()),
};

export const completeExecutionArgsValidator = {
  executionId: v.id('wfExecutions'),
  output: jsonValueValidator,
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
  metadata: v.optional(jsonRecordValidator),
};

export const setComponentWorkflowArgsValidator = {
  executionId: v.id('wfExecutions'),
  componentWorkflowId: v.string(),
};

export const updateExecutionMetadataArgsValidator = {
  executionId: v.id('wfExecutions'),
  metadata: jsonRecordValidator,
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
  organizationId: v.optional(v.string()), // Added for compatibility with useOffsetPaginatedQuery hook (not used in query)
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

export const listExecutionsCursorArgsValidator = {
  wfDefinitionId: v.id('wfDefinitions'),
  numItems: v.optional(v.number()),
  cursor: v.union(v.string(), v.null()),
  searchTerm: v.optional(v.string()),
  status: v.optional(v.array(v.string())),
  triggeredBy: v.optional(v.array(v.string())),
  dateFrom: v.optional(v.string()),
  dateTo: v.optional(v.string()),
};

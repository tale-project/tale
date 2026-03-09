/**
 * Convex validators for workflow executions
 */

import { v } from 'convex/values';

import { sortOrderValidator } from '../../lib/validators/common';
import {
  jsonRecordValidator,
  jsonValueValidator,
} from '../../lib/validators/json';

export const executionStatusValidator = v.union(
  v.literal('pending'),
  v.literal('running'),
  v.literal('completed'),
  v.literal('failed'),
);

export const executionSortOrderValidator = sortOrderValidator;

export const updateExecutionStatusArgsValidator = v.object({
  executionId: v.string(),
  status: executionStatusValidator,
  currentStepSlug: v.optional(v.string()),
  currentStepName: v.optional(v.string()),
  waitingFor: v.optional(v.string()),
  error: v.optional(v.string()),
});

export const failExecutionArgsValidator = v.object({
  executionId: v.string(),
  error: v.string(),
});

export const patchExecutionArgsValidator = v.object({
  executionId: v.string(),
  updates: v.object({
    threadId: v.optional(v.string()),
    currentStepSlug: v.optional(v.string()),
    variables: v.optional(v.string()),
    metadata: v.optional(v.string()),
  }),
});

export const setComponentWorkflowArgsValidator = v.object({
  executionId: v.string(),
  componentWorkflowId: v.string(),
});

export const updateExecutionVariablesArgsValidator = v.object({
  executionId: v.string(),
  variablesSerialized: v.optional(v.string()),
  variablesStorageId: v.optional(v.string()),
});

export const listExecutionsArgsValidator = v.object({
  wfDefinitionId: v.string(),
  status: v.optional(executionStatusValidator),
  limit: v.optional(v.number()),
  search: v.optional(v.string()),
  triggeredBy: v.optional(v.string()),
  dateFrom: v.optional(v.string()),
  dateTo: v.optional(v.string()),
});

export const listExecutionsCursorArgsValidator = v.object({
  wfDefinitionId: v.string(),
  numItems: v.optional(v.number()),
  cursor: v.union(v.string(), v.null()),
  searchTerm: v.optional(v.string()),
  status: v.optional(v.array(executionStatusValidator)),
  triggeredBy: v.optional(v.array(v.string())),
  dateFrom: v.optional(v.string()),
  dateTo: v.optional(v.string()),
});

export const completeExecutionArgsValidator = v.object({
  executionId: v.string(),
  output: jsonValueValidator,
  variablesSerialized: v.optional(v.string()),
  variablesStorageId: v.optional(v.string()),
});

export const resumeExecutionArgsValidator = v.object({
  executionId: v.string(),
  variablesSerialized: v.optional(v.string()),
  variablesStorageId: v.optional(v.string()),
  metadata: v.optional(jsonRecordValidator),
});

export const updateExecutionMetadataArgsValidator = v.object({
  executionId: v.string(),
  metadata: jsonRecordValidator,
});

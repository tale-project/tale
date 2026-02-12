import { v } from 'convex/values';

import { jsonValueValidator } from '../../lib/shared/schemas/utils/json-value';
import { internalMutation } from '../_generated/server';
import { cleanupExecutionStorage as cleanupExecutionStorageHandler } from '../workflows/executions/cleanup_execution_storage';
import { completeExecution as completeExecutionHandler } from '../workflows/executions/complete_execution';
import { failExecution as failExecutionHandler } from '../workflows/executions/fail_execution';
import { updateExecutionStatus as updateExecutionStatusHandler } from '../workflows/executions/update_execution_status';
import { updateExecutionVariables as updateExecutionVariablesHandler } from '../workflows/executions/update_execution_variables';

export const cleanupExecutionStorage = internalMutation({
  args: {
    executionId: v.id('wfExecutions'),
    variablesStorageId: v.optional(v.id('_storage')),
    outputStorageId: v.optional(v.id('_storage')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await cleanupExecutionStorageHandler(ctx, args);
  },
});

export const failExecution = internalMutation({
  args: {
    executionId: v.id('wfExecutions'),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await failExecutionHandler(ctx, args);
  },
});

export const completeExecution = internalMutation({
  args: {
    executionId: v.id('wfExecutions'),
    output: jsonValueValidator,
    outputStorageId: v.optional(v.id('_storage')),
    variablesSerialized: v.optional(v.string()),
    variablesStorageId: v.optional(v.id('_storage')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await completeExecutionHandler(ctx, args);
  },
});

export const updateExecutionStatus = internalMutation({
  args: {
    executionId: v.id('wfExecutions'),
    status: v.string(),
    currentStepSlug: v.optional(v.string()),
    waitingFor: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await updateExecutionStatusHandler(ctx, args);
  },
});

export const updateExecutionVariables = internalMutation({
  args: {
    executionId: v.id('wfExecutions'),
    variablesSerialized: v.optional(v.string()),
    variablesStorageId: v.optional(v.id('_storage')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await updateExecutionVariablesHandler(ctx, args);
  },
});

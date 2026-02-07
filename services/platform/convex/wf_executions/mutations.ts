import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { jsonValueValidator } from '../../lib/shared/schemas/utils/json-value';
import { failExecution as failExecutionLogic } from '../workflows/executions/fail_execution';
import { completeExecution as completeExecutionLogic } from '../workflows/executions/complete_execution';
import { updateExecutionStatus as updateExecutionStatusLogic } from '../workflows/executions/update_execution_status';
import { updateExecutionVariables as updateExecutionVariablesLogic } from '../workflows/executions/update_execution_variables';

export const failExecution = internalMutation({
  args: {
    executionId: v.id('wfExecutions'),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await failExecutionLogic(ctx, args);
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
    return await completeExecutionLogic(ctx, args);
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
    return await updateExecutionStatusLogic(ctx, args);
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
    return await updateExecutionVariablesLogic(ctx, args);
  },
});

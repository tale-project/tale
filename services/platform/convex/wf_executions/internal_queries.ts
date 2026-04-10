import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';
import { getExecution as getExecutionHandler } from '../workflows/executions/get_execution';
import { getExecutionStepJournal as getExecutionStepJournalHelper } from '../workflows/executions/get_execution_step_journal';
import { getRawExecution as getRawExecutionHandler } from '../workflows/executions/get_raw_execution';
import { listExecutionsCursor as listExecutionsCursorHelper } from '../workflows/executions/list_executions_cursor';

export const getExecution = internalQuery({
  args: {
    executionId: v.id('wfExecutions'),
  },
  handler: async (ctx, args) => {
    const result = await getExecutionHandler(ctx, args.executionId);
    if (!result) return null;
    return result;
  },
});

export const getRawExecution = internalQuery({
  args: {
    executionId: v.id('wfExecutions'),
  },
  handler: async (ctx, args) => {
    return await getRawExecutionHandler(ctx, args.executionId);
  },
});

export const listExecutionsCursorInternal = internalQuery({
  args: {
    wfDefinitionId: v.string(),
    cursor: v.union(v.string(), v.null()),
    numItems: v.optional(v.number()),
    status: v.optional(v.array(v.string())),
    dateFrom: v.optional(v.string()),
    dateTo: v.optional(v.string()),
    searchTerm: v.optional(v.string()),
    triggeredBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await listExecutionsCursorHelper(ctx, args);
  },
});

export const getExecutionStepJournalInternal = internalQuery({
  args: {
    executionId: v.id('wfExecutions'),
  },
  handler: async (ctx, args) => {
    return await getExecutionStepJournalHelper(ctx, args);
  },
});

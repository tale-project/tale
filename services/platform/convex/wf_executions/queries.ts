import { v } from 'convex/values';

import { queryWithRLS } from '../lib/rls';
import { getExecutionStepJournal as getExecutionStepJournalHelper } from '../workflows/executions/get_execution_step_journal';
import { getRawExecution as getRawExecutionHelper } from '../workflows/executions/get_raw_execution';
import { listExecutionsCursor as listExecutionsCursorHelper } from '../workflows/executions/list_executions_cursor';

export const listExecutionsCursor = queryWithRLS({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    cursor: v.optional(v.string()),
    numItems: v.optional(v.number()),
    status: v.optional(v.array(v.string())),
    dateFrom: v.optional(v.string()),
    dateTo: v.optional(v.string()),
    searchTerm: v.optional(v.string()),
    triggeredBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await listExecutionsCursorHelper(ctx, {
      ...args,
      cursor: args.cursor ?? null,
    });
  },
});

export const getExecutionStepJournal = queryWithRLS({
  args: {
    executionId: v.id('wfExecutions'),
  },
  handler: async (ctx, args) => {
    return await getExecutionStepJournalHelper(ctx, args);
  },
});

export const getRawExecution = queryWithRLS({
  args: {
    executionId: v.id('wfExecutions'),
  },
  handler: async (ctx, args) => {
    return await getRawExecutionHelper(ctx, args.executionId);
  },
});

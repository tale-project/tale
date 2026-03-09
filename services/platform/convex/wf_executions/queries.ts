import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import { queryWithRLS } from '../lib/rls';
import { getExecutionStepJournal as getExecutionStepJournalHelper } from '../workflows/executions/get_execution_step_journal';
import { getRawExecution as getRawExecutionHelper } from '../workflows/executions/get_raw_execution';
import { listExecutionsCursor as listExecutionsCursorHelper } from '../workflows/executions/list_executions_cursor';
import { listExecutionsPaginatedNative } from '../workflows/executions/list_executions_paginated_native';

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

export const listExecutions = queryWithRLS({
  args: {
    paginationOpts: paginationOptsValidator,
    wfDefinitionId: v.id('wfDefinitions'),
    status: v.optional(v.array(v.string())),
    dateFrom: v.optional(v.string()),
    dateTo: v.optional(v.string()),
    triggeredBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await listExecutionsPaginatedNative(ctx, args);
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

export const getExecutionStatus = queryWithRLS({
  args: {
    executionId: v.id('wfExecutions'),
  },
  handler: async (ctx, args) => {
    const exec = await ctx.db.get(args.executionId);
    if (!exec) return null;
    return {
      status: exec.status,
      currentStepSlug: exec.currentStepSlug,
      currentStepName: exec.currentStepName,
      loopProgress: exec.loopProgress,
      error: exec.error,
      startedAt: exec.startedAt,
      completedAt: exec.completedAt,
      output: exec.output,
    };
  },
});

export const approxCountExecutions = queryWithRLS({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const cap = 20;
    let count = 0;
    for await (const _ of ctx.db
      .query('wfExecutions')
      .withIndex('by_definition', (q) =>
        q.eq('wfDefinitionId', args.wfDefinitionId),
      )) {
      count++;
      if (count >= cap) break;
    }
    return count;
  },
});

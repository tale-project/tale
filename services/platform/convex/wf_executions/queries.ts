/**
 * Workflow Execution Queries
 */

import { v } from 'convex/values';
import { internalQuery } from '../_generated/server';
import { queryWithRLS } from '../lib/rls';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import { getExecution as getExecutionLogic } from '../workflows/executions/get_execution';
import { getRawExecution as getRawExecutionLogic } from '../workflows/executions/get_raw_execution';
import { listExecutionsCursor as listExecutionsCursorHelper } from '../workflows/executions/list_executions_cursor';
import { getExecutionStepJournal as getExecutionStepJournalHelper } from '../workflows/executions/get_execution_step_journal';

export const getExecution = internalQuery({
  args: {
    executionId: v.id('wfExecutions'),
  },
  handler: async (ctx, args) => {
    const result = await getExecutionLogic(ctx, args.executionId);
    if (!result) return null;
    return {
      ...result,
      variables: result.variables as Record<string, unknown>,
    };
  },
});

export const getRawExecution = internalQuery({
  args: {
    executionId: v.id('wfExecutions'),
  },
  handler: async (ctx, args) => {
    return await getRawExecutionLogic(ctx, args.executionId);
  },
});

export const listExecutionsCursor = queryWithRLS({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    cursor: v.optional(v.string()),
    numItems: v.optional(v.number()),
    status: v.optional(v.array(v.string())),
    dateFrom: v.optional(v.string()),
    dateTo: v.optional(v.string()),
    searchTerm: v.optional(v.string()),
    triggeredBy: v.optional(v.array(v.string())),
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

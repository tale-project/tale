import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';
import { getExecution as getExecutionHandler } from '../workflows/executions/get_execution';
import { getExecutionStepJournal as getExecutionStepJournalHelper } from '../workflows/executions/get_execution_step_journal';
import { getRawExecution as getRawExecutionHandler } from '../workflows/executions/get_raw_execution';
import { listExecutionsCursor as listExecutionsCursorHelper } from '../workflows/executions/list_executions_cursor';

export const getExecution = internalQuery({
  args: {
    executionId: v.id('wfExecutions'),
    /**
     * Caller's organizationId — closes the cross-tenant read IDOR on
     * REST GET endpoints. Optional for in-process callers; REST
     * handlers MUST pass this.
     */
    callerOrgId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const result = await getExecutionHandler(ctx, args.executionId);
    if (!result) return null;
    if (
      args.callerOrgId !== undefined &&
      result.organizationId !== args.callerOrgId
    ) {
      return null;
    }
    return result;
  },
});

export const getRawExecution = internalQuery({
  args: {
    executionId: v.id('wfExecutions'),
    callerOrgId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const result = await getRawExecutionHandler(ctx, args.executionId);
    if (!result) return null;
    if (
      args.callerOrgId !== undefined &&
      result.organizationId !== args.callerOrgId
    ) {
      return null;
    }
    return result;
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
    /**
     * Caller's organizationId — closes the cross-tenant list IDOR on
     * REST `GET /api/v1/workflows/:slug/executions`. Required for REST
     * callers because `wfDefinitionId` is a workflow slug shared by
     * convention across orgs; without this filter, two orgs that
     * happen to use the same slug see each other's executions.
     *
     * Post-filtered: the underlying helper paginates by definition id,
     * so we filter the page after fetch. Pages may be smaller than
     * `numItems` when cross-org rows are filtered out; clients should
     * follow `continueCursor` until `isDone`.
     */
    callerOrgId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { callerOrgId, ...passthrough } = args;
    const result = await listExecutionsCursorHelper(ctx, passthrough);
    if (callerOrgId === undefined) return result;
    return {
      ...result,
      page: result.page.filter((row) => row.organizationId === callerOrgId),
    };
  },
});

export const getExecutionStepJournalInternal = internalQuery({
  args: {
    executionId: v.id('wfExecutions'),
    /**
     * Caller's organizationId — REST endpoint must enforce same-org so
     * one tenant cannot read another's step I/O via execution id.
     */
    callerOrgId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.callerOrgId !== undefined) {
      const exec = await ctx.db.get(args.executionId);
      if (!exec || exec.organizationId !== args.callerOrgId) return null;
    }
    return await getExecutionStepJournalHelper(ctx, args);
  },
});

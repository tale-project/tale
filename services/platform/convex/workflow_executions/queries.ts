import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import { isParkedOnCapacity } from '../../lib/shared/platform/run_capacity';
import { queryWithRLS } from '../lib/rls';
import { getExecutionStepJournal as getExecutionStepJournalHelper } from '../workflows/executions/get_execution_step_journal';
import { getExecutionStepStatuses as getExecutionStepStatusesHelper } from '../workflows/executions/get_execution_step_statuses';
import { getOrgWorkflowMetrics as getOrgWorkflowMetricsHelper } from '../workflows/executions/get_org_workflow_metrics';
import { getRawExecution as getRawExecutionHelper } from '../workflows/executions/get_raw_execution';
import { listExecutionsCursor as listExecutionsCursorHelper } from '../workflows/executions/list_executions_cursor';
import { listExecutionsPaginatedNative } from '../workflows/executions/list_executions_paginated_native';

export const listExecutionsCursor = queryWithRLS({
  args: {
    wfDefinitionId: v.string(),
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

export const getExecutionStepStatuses = queryWithRLS({
  args: {
    // v.string() + normalizeId instead of v.id: the execution id arrives from
    // a user-editable URL param, and a malformed value must resolve to `null`
    // rather than throw an ArgumentValidationError at the subscription.
    executionId: v.string(),
  },
  handler: async (ctx, args) => {
    const executionId = ctx.db.normalizeId('wfExecutions', args.executionId);
    if (!executionId) return null;
    return await getExecutionStepStatusesHelper(ctx, { executionId });
  },
});

/**
 * The latest execution "about" a generic domain resource (subjectType, subjectId)
 * — e.g. the run a task kicked off. Lets ANY UI component show its resource's run
 * inline without a per-component schema field. Returns a small summary; the caller
 * uses `executionId` to drive the reused run views (DAG / EmbeddedRun).
 */
export const getLatestExecutionForSubject = queryWithRLS({
  args: {
    organizationId: v.string(),
    subjectType: v.string(),
    subjectId: v.string(),
  },
  returns: v.union(
    v.object({
      executionId: v.id('wfExecutions'),
      status: v.string(),
      currentStepSlug: v.optional(v.string()),
      currentStepName: v.optional(v.string()),
      startedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('wfExecutions')
      .withIndex('by_org_subject', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('subjectType', args.subjectType)
          .eq('subjectId', args.subjectId),
      )
      .order('desc')
      .first();
    if (!row) return null;
    return {
      executionId: row._id,
      status: row.status,
      ...(row.currentStepSlug !== '' && {
        currentStepSlug: row.currentStepSlug,
      }),
      ...(row.currentStepName !== undefined && {
        currentStepName: row.currentStepName,
      }),
      startedAt: row.startedAt,
    };
  },
});

/**
 * Whether the latest run "about" a subject is currently parked on sandbox
 * capacity (queued behind the org's concurrency cap). A tiny boolean so a list
 * can show a per-row ambient "Queued for capacity" chip without subscribing each
 * visible row to the full execution summary — Convex pushes an update only when
 * the boolean flips, not on every ~4s poll of the running execution.
 */
export const getSubjectAwaitingCapacity = queryWithRLS({
  args: {
    organizationId: v.string(),
    subjectType: v.string(),
    subjectId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('wfExecutions')
      .withIndex('by_org_subject', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('subjectType', args.subjectType)
          .eq('subjectId', args.subjectId),
      )
      .order('desc')
      .first();
    return isParkedOnCapacity(row);
  },
});

export const listExecutions = queryWithRLS({
  args: {
    paginationOpts: paginationOptsValidator,
    wfDefinitionId: v.string(),
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
      waitingFor: exec.waitingFor,
      error: exec.error,
      errorCode: exec.errorCode,
      startedAt: exec.startedAt,
      completedAt: exec.completedAt,
      output: exec.output,
    };
  },
});

export const getOrgWorkflowMetrics = queryWithRLS({
  args: {
    organizationId: v.string(),
    periodDays: v.union(v.literal(7), v.literal(30), v.literal(90)),
  },
  handler: async (ctx, args) => {
    return await getOrgWorkflowMetricsHelper(ctx, args);
  },
});

export const approxCountExecutions = queryWithRLS({
  args: {
    wfDefinitionId: v.string(),
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

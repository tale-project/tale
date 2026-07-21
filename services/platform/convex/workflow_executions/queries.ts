import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import {
  deriveRunIndicator,
  isActiveExecutionStatus,
} from '../../lib/shared/platform/run_capacity';
import * as ApprovalsHelpers from '../approvals/helpers';
import { queryWithRLS } from '../lib/rls';
import { TERMINAL_STATUSES } from '../tasks/helpers';
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
 * The ambient run indicator for a subject's row, derived from the subject's
 * latest run (see `deriveRunIndicator`): `state` is
 * `'parked' | 'failed' | 'awaiting_input' | 'starting' | null` and, when
 * failed, `failedExecutionId` carries that run's id so the row can offer a
 * one-click re-run (`rerunExecution`). A tiny value (not the full run summary)
 * so a list can show a per-row chip + retry without subscribing each visible
 * row to the heavy execution summary: Convex pushes an update only when the
 * indicator flips, not on every ~4s poll of a running execution.
 *
 * A RESOLVED subject returns `null`: a task already done/cancelled keeps showing
 * its real terminal status, never a stale "Failed" chip or a Re-run offer for a
 * past crashed automation — the work is closed regardless of that run.
 */
export const getSubjectRunIndicator = queryWithRLS({
  args: {
    organizationId: v.string(),
    subjectType: v.string(),
    subjectId: v.string(),
  },
  returns: v.object({
    state: v.union(
      v.literal('parked'),
      v.literal('failed'),
      v.literal('awaiting_input'),
      v.literal('starting'),
      v.null(),
    ),
    failedExecutionId: v.union(v.id('wfExecutions'), v.null()),
  }),
  handler: async (ctx, args) => {
    // A resolved subject has no actionable run state to surface. For a task
    // that's already done/cancelled, keep its real terminal badge instead of
    // overriding it with a "Failed" chip (or offering a Re-run) for an old run.
    // RLS wraps the wfExecutions query below; `ctx.db.get` bypasses it, so match
    // the org explicitly.
    let taskStatus: string | undefined;
    if (args.subjectType === 'task') {
      const taskId = ctx.db.normalizeId('tasks', args.subjectId);
      const task = taskId ? await ctx.db.get(taskId) : null;
      if (task && task.organizationId === args.organizationId) {
        if (TERMINAL_STATUSES.has(task.status)) {
          return { state: null, failedExecutionId: null };
        }
        taskStatus = task.status;
      }
    }
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
    let state: 'parked' | 'failed' | 'awaiting_input' | 'starting' | null =
      deriveRunIndicator(row);
    // A run that ended by asking the operator for a decision leaves a pending
    // human-input / review approval keyed to that execution — surface it as
    // "awaiting input" so a parked-for-input row reads distinctly from a fresh
    // To do. Keyed to the execution, it clears on its own once a newer run (the
    // operator's reply) supersedes this one.
    if (state === null && row) {
      const pending = await ApprovalsHelpers.listPendingApprovalsForExecution(
        ctx,
        row._id,
      );
      if (
        pending.some(
          (a) =>
            a.resourceType === 'operator_input' ||
            a.resourceType === 'human_input_request' ||
            a.resourceType === 'task_review',
        )
      ) {
        state = 'awaiting_input';
      }
    }
    // A run is active but the task's own status doesn't show it yet — the
    // window between the desk's Start and the workflow's ack step flipping the
    // task to in_progress (engine pickup can take seconds). Surface it as
    // "starting" so the row visibly reacts to Start instead of sitting on a
    // stale Backlog badge. Task-only: only a task's own status can prove the
    // run state would otherwise be invisible.
    if (
      state === null &&
      row &&
      isActiveExecutionStatus(row.status) &&
      taskStatus !== undefined &&
      taskStatus !== 'in_progress'
    ) {
      state = 'starting';
    }
    return {
      state,
      failedExecutionId: state === 'failed' && row ? row._id : null,
    };
  },
});

/**
 * Coerce an approval's `metadata.questions` into a clean `string[]`. The value
 * is written by whatever workflow parked the run: a whole-value `{{…}}` template
 * injects the raw array, but a stringified array or an array of `{prompt}` objects
 * are equally plausible from other automations — accept all three so the answer
 * panel is robust to how the marker was authored, never leaking `[object Object]`.
 */
function normalizeInputQuestions(raw: unknown): string[] {
  const toLine = (q: unknown): string => {
    if (typeof q === 'string') return q.trim();
    if (typeof q === 'object' && q !== null && 'prompt' in q) {
      const prompt: unknown = q.prompt;
      return typeof prompt === 'string' ? prompt.trim() : '';
    }
    return '';
  };
  if (Array.isArray(raw)) return raw.map(toLine).filter(Boolean);
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [];
    try {
      const parsed: unknown = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map(toLine).filter(Boolean);
    } catch {
      // Not JSON — a single free-text question line.
    }
    return [s];
  }
  return [];
}

/**
 * The pending human-input request on a subject's latest run — the data behind the
 * inline answer panel. When a run parked by minting a human-input marker
 * (`operator_input` / `human_input_request` / `task_review`), returns that run's id
 * and the question(s) the marker carried in `metadata.questions`, so a row can render
 * the ask inline and let the operator answer in place instead of hunting through the
 * task thread. Returns `null` for a resolved subject, a run with no such pending
 * marker, or a marker that carried no questions.
 *
 * Kept separate from `getSubjectRunIndicator` (a tiny state flag polled per visible
 * row): the heavier question payload loads only when a component actually mounts the
 * panel. Like the indicator, this is platform code over org-RLS-gated execution data.
 */
export const getSubjectInputRequest = queryWithRLS({
  args: {
    organizationId: v.string(),
    subjectType: v.string(),
    subjectId: v.string(),
  },
  returns: v.union(
    v.object({
      executionId: v.id('wfExecutions'),
      questions: v.array(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    // A resolved task has no open question to answer — mirror the indicator's guard.
    if (args.subjectType === 'task') {
      const taskId = ctx.db.normalizeId('tasks', args.subjectId);
      const task = taskId ? await ctx.db.get(taskId) : null;
      if (
        task &&
        task.organizationId === args.organizationId &&
        TERMINAL_STATUSES.has(task.status)
      ) {
        return null;
      }
    }
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
    const pending = await ApprovalsHelpers.listPendingApprovalsForExecution(
      ctx,
      row._id,
    );
    const marker = pending.find(
      (a) =>
        a.resourceType === 'operator_input' ||
        a.resourceType === 'human_input_request' ||
        a.resourceType === 'task_review',
    );
    if (!marker) return null;
    const questions = normalizeInputQuestions(marker.metadata?.['questions']);
    if (questions.length === 0) return null;
    return { executionId: row._id, questions };
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

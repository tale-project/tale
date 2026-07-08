/**
 * Internal metrics reads for automations — currently the daily-digest
 * workflow's one query. Computes the day's task/agent-run summary from LIVE
 * domain tables with hard scan caps (the snapshot rollups of the metrics
 * milestone will take over the long-window aggregations; a one-day window
 * fits comfortably under these caps for any realistic org).
 *
 * Deterministic counts only — the digest renders via ICU templates, zero
 * LLM tokens.
 */

import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';
import { TASK_METRIC_ACTIONS } from '../tasks/helpers';

const ACTIVITY_SCAN_CAP = 2000;
const RUNS_SCAN_CAP = 1000;
const APPROVALS_SCAN_CAP = 200;
const NOTICES_SCAN_CAP = 200;

export interface DailySummary {
  tasksCreated: number;
  tasksCompleted: number;
  tasksCancelled: number;
  reviewsPassed: number;
  reviewsChangesRequested: number;
  runs: number;
  runsFailed: number;
  costCents: number;
  pendingReviews: number;
  queuedRuns: number;
  openBreakers: number;
  /** True when any scan hit its cap — counts are then lower bounds. */
  capped: boolean;
}

export const getDailySummaryInternal = internalQuery({
  args: {
    organizationId: v.string(),
    windowHours: v.optional(v.number()),
  },
  returns: v.object({
    tasksCreated: v.number(),
    tasksCompleted: v.number(),
    tasksCancelled: v.number(),
    reviewsPassed: v.number(),
    reviewsChangesRequested: v.number(),
    runs: v.number(),
    runsFailed: v.number(),
    costCents: v.number(),
    pendingReviews: v.number(),
    queuedRuns: v.number(),
    openBreakers: v.number(),
    capped: v.boolean(),
  }),
  handler: async (ctx, args): Promise<DailySummary> => {
    const windowHours = Math.min(Math.max(args.windowHours ?? 24, 1), 24 * 7);
    const since = Date.now() - windowHours * 60 * 60 * 1000;
    let capped = false;

    // Task lifecycle + review outcomes from the activity timeline.
    let tasksCreated = 0;
    let tasksCompleted = 0;
    let tasksCancelled = 0;
    let reviewsPassed = 0;
    let reviewsChangesRequested = 0;
    let activityScanned = 0;
    for await (const row of ctx.db
      .query('taskActivity')
      .withIndex('by_org_createdAt', (q) =>
        q.eq('organizationId', args.organizationId).gt('createdAt', since),
      )) {
      activityScanned += 1;
      if (activityScanned > ACTIVITY_SCAN_CAP) {
        capped = true;
        break;
      }
      switch (row.action) {
        case 'created':
          tasksCreated += 1;
          break;
        case 'status.changed':
          if (row.toValue === 'done') tasksCompleted += 1;
          else if (row.toValue === 'cancelled') tasksCancelled += 1;
          break;
        case TASK_METRIC_ACTIONS.reviewPassed:
          reviewsPassed += 1;
          break;
        case TASK_METRIC_ACTIONS.reviewChangesRequested:
          reviewsChangesRequested += 1;
          break;
        default:
          break;
      }
    }

    // Agent runs + spend.
    let runs = 0;
    let runsFailed = 0;
    let costCents = 0;
    for await (const run of ctx.db
      .query('taskAgentRuns')
      .withIndex('by_org_started', (q) =>
        q.eq('organizationId', args.organizationId).gt('startedAt', since),
      )) {
      runs += 1;
      if (runs > RUNS_SCAN_CAP) {
        capped = true;
        runs = RUNS_SCAN_CAP;
        break;
      }
      if (run.status === 'failed' || run.status === 'timed_out') {
        runsFailed += 1;
      }
      costCents += run.costCents;
    }

    // Currently-pending reviews (state, not windowed).
    let pendingReviews = 0;
    for await (const approval of ctx.db
      .query('approvals')
      .withIndex('by_org_status_resourceType', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('status', 'pending')
          .eq('resourceType', 'task_review'),
      )) {
      void approval;
      pendingReviews += 1;
      if (pendingReviews > APPROVALS_SCAN_CAP) {
        capped = true;
        pendingReviews = APPROVALS_SCAN_CAP;
        break;
      }
    }

    // Open guardrail state: queued runs + tripped breakers awaiting a human.
    let queuedRuns = 0;
    let openBreakers = 0;
    for (const kind of ['concurrency_queued', 'circuit_tripped'] as const) {
      let scanned = 0;
      for await (const notice of ctx.db
        .query('agentGuardrailNotices')
        .withIndex('by_org_kind_resolved', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('kind', kind)
            .eq('resolvedAt', undefined),
        )) {
        void notice;
        scanned += 1;
        if (scanned > NOTICES_SCAN_CAP) {
          capped = true;
          break;
        }
        if (kind === 'concurrency_queued') queuedRuns += 1;
        else openBreakers += 1;
      }
    }

    return {
      tasksCreated,
      tasksCompleted,
      tasksCancelled,
      reviewsPassed,
      reviewsChangesRequested,
      runs,
      runsFailed,
      costCents,
      pendingReviews,
      queuedRuns,
      openBreakers,
      capped,
    };
  },
});

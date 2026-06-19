/**
 * External-run state machine — the ONLY writers of `externalRuns`.
 *
 * Contracts (workforce cross-pillar):
 *  - The unified `taskAgentRuns` row is created at CLAIM through
 *    `startTaskAgentRun` (transactional admission: guard re-check with the
 *    frozen enqueue-time budget inputs + concurrency counters) and closed
 *    through `recordTaskRunUsage`/`finalizeTaskAgentRun` — external work
 *    shows up in metrics, budgets, and the per-task run history exactly
 *    like internal runs.
 *  - `complete` hard-codes the task to `in_review` (workflow actor): the
 *    resulting `task.status_changed` event is what wakes the review-gate
 *    workflow. No daemon input can mark a task done.
 *  - Failures roll the task back to `todo` with an explanatory comment and
 *    emit `task.external_run_failed`.
 *  - Atomicity rides Convex OCC: two daemons claiming the same run conflict
 *    and one retries against the already-claimed row (exactly-once handout).
 *
 * `[ExternalRuns]` logging: state transitions only — never prompt bodies.
 */

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { internalMutation, type MutationCtx } from '../_generated/server';
import { checkAgentRunAllowedHelper } from '../agents/guardrails/budget_guard';
import { taskAgentRunTriggerValidator } from '../task_metrics/schema';
import { emitEvent } from '../workflows/triggers/emit_event';
import {
  EXTERNAL_CLAIM_LEASE_MS,
  EXTERNAL_DISPATCH_DEADLINE_MS,
  EXTERNAL_MAX_ATTEMPTS,
  EXTERNAL_PROMPT_MAX_CHARS,
  EXTERNAL_RUN_TIMEOUT_MS,
  externalRunPermissionModeValidator,
} from './schema';

const WORKFLOW_ACTOR_ID = 'workflow';
const CLAIM_SCAN_CAP = 25;
const SWEEP_CAP = 50;

function logRun(stage: string, fields: Record<string, unknown>): void {
  console.log(
    `[ExternalRuns] ${stage} ` +
      Object.entries(fields)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(' '),
  );
}

const guardBudgetValidator = v.object({
  monthlyCents: v.number(),
  warnPct: v.optional(v.number()),
  pausePct: v.optional(v.number()),
});

export const enqueueExternalRun = internalMutation({
  args: {
    organizationId: v.string(),
    taskId: v.id('tasks'),
    agentSlug: v.string(),
    adapterType: v.string(),
    daemonId: v.optional(v.string()),
    workspaceKey: v.optional(v.string()),
    permissionMode: externalRunPermissionModeValidator,
    kind: v.union(v.literal('initial'), v.literal('revision')),
    trigger: taskAgentRunTriggerValidator,
    resumeSessionRef: v.optional(v.string()),
    prompt: v.string(),
    guardBudget: v.optional(guardBudgetValidator),
    guardMaxConcurrentTasks: v.optional(v.number()),
    wfExecutionId: v.optional(v.string()),
    workflowSlug: v.optional(v.string()),
    // Plain (non-secret) env the agent declared — handed to the daemon at claim
    // and merged into the spawned agent process (secrets stay the machine's own).
    env: v.optional(v.record(v.string(), v.string())),
  },
  returns: v.object({
    enqueued: v.boolean(),
    externalRunId: v.optional(v.id('externalRuns')),
    reason: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    enqueued: boolean;
    externalRunId?: Id<'externalRuns'>;
    reason?: string;
  }> => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.organizationId !== args.organizationId) {
      return { enqueued: false, reason: 'TASK_NOT_FOUND' };
    }
    // One live external run per task: a duplicate dispatch (event re-fire,
    // workflow retry) must not fan out to two daemons.
    for await (const existing of ctx.db
      .query('externalRuns')
      .withIndex('by_task', (q) => q.eq('taskId', args.taskId))) {
      if (
        existing.status === 'queued' ||
        existing.status === 'claimed' ||
        existing.status === 'running'
      ) {
        return {
          enqueued: false,
          externalRunId: existing._id,
          reason: 'ALREADY_DISPATCHED',
        };
      }
    }

    // Revision runs resume the previous session when the adapter returned
    // one (newest completed run for this task+agent+adapter wins).
    let resumeSessionRef = args.resumeSessionRef;
    if (args.kind === 'revision' && !resumeSessionRef) {
      for await (const prior of ctx.db
        .query('externalRuns')
        .withIndex('by_task', (q) => q.eq('taskId', args.taskId))) {
        if (
          prior.status === 'completed' &&
          prior.agentSlug === args.agentSlug &&
          prior.adapterType === args.adapterType &&
          prior.sessionRef
        ) {
          resumeSessionRef = prior.sessionRef;
        }
      }
    }

    const now = Date.now();
    const externalRunId = await ctx.db.insert('externalRuns', {
      organizationId: args.organizationId,
      taskId: args.taskId,
      projectId: task.projectId,
      agentSlug: args.agentSlug,
      adapterType: args.adapterType,
      daemonId: args.daemonId,
      workspaceKey: args.workspaceKey,
      permissionMode: args.permissionMode,
      kind: args.kind,
      trigger: args.trigger,
      resumeSessionRef,
      prompt: args.prompt.slice(0, EXTERNAL_PROMPT_MAX_CHARS),
      status: 'queued',
      attempts: 0,
      maxAttempts: EXTERNAL_MAX_ATTEMPTS,
      guardBudget: args.guardBudget,
      guardMaxConcurrentTasks: args.guardMaxConcurrentTasks,
      wfExecutionId: args.wfExecutionId,
      workflowSlug: args.workflowSlug,
      env: args.env,
      createdAt: now,
      dispatchDeadlineAt: now + EXTERNAL_DISPATCH_DEADLINE_MS,
    });
    logRun('enqueued', {
      externalRunId,
      org: args.organizationId,
      task: args.taskId,
      agent: args.agentSlug,
      adapter: args.adapterType,
      kind: args.kind,
    });
    // Self-scheduled watchdog: if no daemon claims it by the dispatch
    // deadline, the sweep fails it (runtime_offline) — no fleet cron needed.
    await ctx.scheduler.runAfter(
      EXTERNAL_DISPATCH_DEADLINE_MS + 5_000,
      internal.external_runs.internal_mutations.sweepExternalRuns,
      { organizationId: args.organizationId },
    );
    return { enqueued: true, externalRunId };
  },
});

/**
 * Hand the oldest eligible queued run to a polling daemon. Eligibility:
 * adapter match, daemon pin match, dispatch deadline not passed, and the
 * agent's guardrails admit the run RIGHT NOW (capped/paused agents' runs
 * stay queued — budget pauses skip, concurrency waits). Admission inserts
 * the unified `taskAgentRuns` row before the work item leaves the server.
 */
export const claimExternalRun = internalMutation({
  args: {
    organizationId: v.string(),
    daemonId: v.string(),
    adapterTypes: v.array(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const adapters = new Set(args.adapterTypes);
    let scanned = 0;

    for await (const run of ctx.db
      .query('externalRuns')
      .withIndex('by_org_status', (q) =>
        q.eq('organizationId', args.organizationId).eq('status', 'queued'),
      )) {
      scanned += 1;
      if (scanned > CLAIM_SCAN_CAP) break;
      if (!adapters.has(run.adapterType)) continue;
      if (run.daemonId && run.daemonId !== args.daemonId) continue;
      if (run.dispatchDeadlineAt < now) continue; // sweep will fail it
      if (run.cancelRequested) continue; // sweep will cancel it

      const task = await ctx.db.get(run.taskId);
      if (
        !task ||
        task.archivedAt ||
        task.status === 'done' ||
        task.status === 'cancelled'
      ) {
        continue; // sweep cleans up
      }

      // Guard re-check with the frozen enqueue-time inputs.
      const verdict = await checkAgentRunAllowedHelper(ctx, {
        organizationId: args.organizationId,
        agentSlug: run.agentSlug,
        context: 'external_claim',
        taskId: run.taskId,
        budget: run.guardBudget,
        maxConcurrentTasks: run.guardMaxConcurrentTasks,
      });
      if (!verdict.allowed) continue; // stays queued; try the next run

      const admission: { started: boolean; runId?: Id<'taskAgentRuns'> } =
        await ctx.runMutation(
          internal.task_metrics.internal_mutations.startTaskAgentRun,
          {
            organizationId: args.organizationId,
            taskId: run.taskId,
            agentSlug: run.agentSlug,
            trigger: run.trigger,
            workflowSlug: run.workflowSlug,
            guardContext: 'external_claim',
            budget: run.guardBudget,
            maxConcurrentTasks: run.guardMaxConcurrentTasks,
          },
        );
      if (!admission.started || !admission.runId) continue;

      await ctx.db.patch(run._id, {
        status: 'claimed',
        claimedByDaemonId: args.daemonId,
        claimedAt: now,
        leaseExpiresAt: now + EXTERNAL_CLAIM_LEASE_MS,
        timeoutAt: now + EXTERNAL_RUN_TIMEOUT_MS,
        attempts: run.attempts + 1,
        runId: admission.runId,
      });
      logRun('claimed', {
        externalRunId: run._id,
        daemon: args.daemonId,
        attempt: run.attempts + 1,
        agent: run.agentSlug,
      });
      // Watchdogs for THIS attempt: quick lease-death requeue and the hard
      // run timeout. Heartbeats keep the lease fresh while the daemon lives.
      await ctx.scheduler.runAfter(
        EXTERNAL_CLAIM_LEASE_MS * 2,
        internal.external_runs.internal_mutations.sweepExternalRuns,
        { organizationId: args.organizationId },
      );
      await ctx.scheduler.runAfter(
        EXTERNAL_RUN_TIMEOUT_MS + 60_000,
        internal.external_runs.internal_mutations.sweepExternalRuns,
        { organizationId: args.organizationId },
      );
      return {
        externalRunId: run._id,
        taskId: String(run.taskId),
        agentSlug: run.agentSlug,
        adapterType: run.adapterType,
        permissionMode: run.permissionMode,
        workspaceKey: run.workspaceKey,
        kind: run.kind,
        resumeSessionRef: run.resumeSessionRef,
        prompt: run.prompt,
        ...(run.env !== undefined && { env: run.env }),
        timeoutMs: EXTERNAL_RUN_TIMEOUT_MS,
      };
    }
    return null;
  },
});

/** Daemon-side guard: the run must belong to this org + daemon and be live. */
async function loadOwnedRun(
  ctx: MutationCtx,
  externalRunId: Id<'externalRuns'>,
  organizationId: string,
  daemonId: string,
): Promise<Doc<'externalRuns'> | null> {
  const run = await ctx.db.get(externalRunId);
  if (!run) return null;
  if (run.organizationId !== organizationId) return null;
  if (run.claimedByDaemonId !== daemonId) return null;
  return run;
}

export const recordExternalRunEvent = internalMutation({
  args: {
    organizationId: v.string(),
    daemonId: v.string(),
    externalRunId: v.id('externalRuns'),
    eventType: v.union(
      v.literal('started'),
      v.literal('progress'),
      v.literal('heartbeat'),
    ),
    message: v.optional(v.string()),
  },
  returns: v.object({ ok: v.boolean(), cancelRequested: v.boolean() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; cancelRequested: boolean }> => {
    const run = await loadOwnedRun(
      ctx,
      args.externalRunId,
      args.organizationId,
      args.daemonId,
    );
    if (!run || (run.status !== 'claimed' && run.status !== 'running')) {
      return { ok: false, cancelRequested: true };
    }
    const now = Date.now();
    const patch: Partial<Doc<'externalRuns'>> = {
      leaseExpiresAt: now + EXTERNAL_CLAIM_LEASE_MS,
    };
    if (run.status === 'claimed' && args.eventType === 'started') {
      patch.status = 'running';
      patch.startedAt = now;
    }
    await ctx.db.patch(run._id, patch);

    // Progress goes to the activity timeline (not comments — no noise).
    if (args.eventType === 'progress' && args.message) {
      const task = await ctx.db.get(run.taskId);
      if (task) {
        await ctx.db.insert('taskActivity', {
          organizationId: run.organizationId,
          taskId: run.taskId,
          projectId: run.projectId,
          actorType: 'agent',
          actorId: run.agentSlug,
          action: 'external.progress',
          toValue: args.message.slice(0, 200),
          createdAt: now,
        });
      }
    }
    return { ok: true, cancelRequested: run.cancelRequested === true };
  },
});

export const completeExternalRun = internalMutation({
  args: {
    organizationId: v.string(),
    daemonId: v.string(),
    externalRunId: v.id('externalRuns'),
    summary: v.string(),
    diffStat: v.optional(v.string()),
    sessionRef: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    costCents: v.optional(v.number()),
  },
  returns: v.object({ ok: v.boolean(), reason: v.optional(v.string()) }),
  handler: async (ctx, args): Promise<{ ok: boolean; reason?: string }> => {
    const run = await loadOwnedRun(
      ctx,
      args.externalRunId,
      args.organizationId,
      args.daemonId,
    );
    if (!run) return { ok: false, reason: 'RUN_NOT_FOUND' };
    if (run.status !== 'claimed' && run.status !== 'running') {
      return { ok: false, reason: 'RUN_NOT_LIVE' };
    }

    const now = Date.now();
    await ctx.db.patch(run._id, {
      status: 'completed',
      completedAt: now,
      sessionRef: args.sessionRef,
      resultSummary: args.summary.slice(0, 10_000),
      diffStat: args.diffStat?.slice(0, 2_000),
    });

    if (run.runId) {
      await ctx.runMutation(
        internal.task_metrics.internal_mutations.recordTaskRunUsage,
        {
          runId: run.runId,
          inputTokens: args.inputTokens,
          outputTokens: args.outputTokens,
          costCents: args.costCents,
        },
      );
      await ctx.runMutation(
        internal.task_metrics.internal_mutations.finalizeTaskAgentRun,
        { runId: run.runId, status: 'completed', outcome: 'output_posted' },
      );
    }

    // Result comment as the AGENT, then park at In review (workflow actor —
    // the status_changed event wakes the review-gate workflow).
    const body = args.diffStat
      ? `${args.summary}\n\n\`\`\`\n${args.diffStat}\n\`\`\``
      : args.summary;
    await ctx.runMutation(internal.tasks.internal_mutations.agentAddComment, {
      organizationId: run.organizationId,
      actorId: run.agentSlug,
      taskId: run.taskId,
      body: body.slice(0, 9_500),
    });
    await ctx.runMutation(
      internal.tasks.internal_mutations.agentUpdateTaskStatus,
      {
        organizationId: run.organizationId,
        actorId: WORKFLOW_ACTOR_ID,
        taskId: run.taskId,
        status: 'in_review',
      },
    );
    logRun('completed', {
      externalRunId: run._id,
      daemon: args.daemonId,
      costCents: args.costCents,
    });
    return { ok: true };
  },
});

/** Shared terminal-failure path (daemon report, sweep, cancellation). */
async function failRun(
  ctx: MutationCtx,
  run: Doc<'externalRuns'>,
  args: { reason: string; error?: string; retryable: boolean },
): Promise<void> {
  const now = Date.now();
  const canRetry = args.retryable && run.attempts < run.maxAttempts;

  // The claimed attempt's metrics row closes either way; a retry gets a
  // fresh row at its own claim.
  if (run.runId) {
    await ctx.runMutation(
      internal.task_metrics.internal_mutations.finalizeTaskAgentRun,
      {
        runId: run.runId,
        status: args.reason === 'timeout' ? 'timed_out' : 'failed',
        outcome: 'error',
        error: (args.error ?? args.reason).slice(0, 500),
      },
    );
  }

  if (canRetry) {
    await ctx.db.patch(run._id, {
      status: 'queued',
      claimedByDaemonId: undefined,
      claimedAt: undefined,
      leaseExpiresAt: undefined,
      timeoutAt: undefined,
      startedAt: undefined,
      runId: undefined,
      dispatchDeadlineAt: now + EXTERNAL_DISPATCH_DEADLINE_MS,
    });
    logRun('requeued', {
      externalRunId: run._id,
      reason: args.reason,
      attempt: run.attempts,
    });
    return;
  }

  await ctx.db.patch(run._id, {
    status: 'failed',
    failReason: args.reason,
    completedAt: now,
  });
  await ctx.runMutation(internal.tasks.internal_mutations.agentAddComment, {
    organizationId: run.organizationId,
    actorId: WORKFLOW_ACTOR_ID,
    taskId: run.taskId,
    body: `[automated] ⚠️ External run on ${run.adapterType} failed (${args.reason})${args.error ? `: ${args.error.slice(0, 300)}` : ''} — returned to To do.`,
  });
  await ctx.runMutation(
    internal.tasks.internal_mutations.agentUpdateTaskStatus,
    {
      organizationId: run.organizationId,
      actorId: WORKFLOW_ACTOR_ID,
      taskId: run.taskId,
      status: 'todo',
    },
  );
  await emitEvent(ctx, {
    organizationId: run.organizationId,
    eventType: 'task.external_run_failed',
    eventData: {
      taskId: String(run.taskId),
      projectId: String(run.projectId),
      agentSlug: run.agentSlug,
      adapterType: run.adapterType,
      reason: args.reason,
    },
  });
  logRun('failed', {
    externalRunId: run._id,
    reason: args.reason,
  });
}

export const failExternalRun = internalMutation({
  args: {
    organizationId: v.string(),
    daemonId: v.string(),
    externalRunId: v.id('externalRuns'),
    error: v.string(),
    retryable: v.optional(v.boolean()),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const run = await loadOwnedRun(
      ctx,
      args.externalRunId,
      args.organizationId,
      args.daemonId,
    );
    if (!run || (run.status !== 'claimed' && run.status !== 'running')) {
      return { ok: false };
    }
    await failRun(ctx, run, {
      reason: 'error',
      error: args.error,
      retryable: args.retryable ?? false,
    });
    return { ok: true };
  },
});

/** Request cancellation; the daemon learns via heartbeat/events and SIGTERMs. */
export const cancelExternalRun = internalMutation({
  args: { externalRunId: v.id('externalRuns') },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const run = await ctx.db.get(args.externalRunId);
    if (!run) return null;
    if (run.status === 'queued') {
      await ctx.db.patch(run._id, {
        status: 'cancelled',
        completedAt: Date.now(),
      });
      logRun('cancelled', { externalRunId: run._id, from: 'queued' });
    } else if (run.status === 'claimed' || run.status === 'running') {
      await ctx.db.patch(run._id, { cancelRequested: true });
      logRun('cancelRequested', { externalRunId: run._id });
    }
    return null;
  },
});

/**
 * Watchdog: dispatch-deadline expiry (no daemon picked it up), lease expiry
 * (daemon died mid-run), hard run timeout, and cancel acknowledgment for
 * dead daemons. Cron-driven per org page; bounded.
 */
export const sweepExternalRuns = internalMutation({
  args: { organizationId: v.string() },
  returns: v.object({ swept: v.number() }),
  handler: async (ctx, args): Promise<{ swept: number }> => {
    const now = Date.now();
    let swept = 0;

    for await (const run of ctx.db
      .query('externalRuns')
      .withIndex('by_org_status', (q) =>
        q.eq('organizationId', args.organizationId).eq('status', 'queued'),
      )) {
      if (swept >= SWEEP_CAP) break;
      if (run.cancelRequested) {
        await ctx.db.patch(run._id, { status: 'cancelled', completedAt: now });
        swept += 1;
        continue;
      }
      if (run.dispatchDeadlineAt < now) {
        await failRun(ctx, run, {
          reason: 'runtime_offline',
          retryable: false,
        });
        swept += 1;
      }
    }

    for (const status of ['claimed', 'running'] as const) {
      for await (const run of ctx.db
        .query('externalRuns')
        .withIndex('by_org_status', (q) =>
          q.eq('organizationId', args.organizationId).eq('status', status),
        )) {
        if (swept >= SWEEP_CAP) break;
        if (run.cancelRequested && (run.leaseExpiresAt ?? 0) < now) {
          // Daemon never acked the cancel — close it out.
          if (run.runId) {
            await ctx.runMutation(
              internal.task_metrics.internal_mutations.finalizeTaskAgentRun,
              {
                runId: run.runId,
                status: 'failed',
                outcome: 'error',
                error: 'cancelled',
              },
            );
          }
          await ctx.db.patch(run._id, {
            status: 'cancelled',
            completedAt: now,
          });
          swept += 1;
          continue;
        }
        if ((run.timeoutAt ?? Number.MAX_SAFE_INTEGER) < now) {
          await failRun(ctx, run, { reason: 'timeout', retryable: false });
          swept += 1;
          continue;
        }
        if ((run.leaseExpiresAt ?? 0) < now) {
          await failRun(ctx, run, { reason: 'lease_expired', retryable: true });
          swept += 1;
        }
      }
    }
    return { swept };
  },
});

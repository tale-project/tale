/**
 * Run-lifecycle internal mutations — the ONLY writers of `taskAgentRuns` and
 * of the `agentRunCounters` concurrency semaphore.
 *
 * Every agent run on a task (internal LLM loop, workflow-dispatched, external
 * runtime) goes through this exact lifecycle:
 *
 *   startTaskAgentRun      — transactional admission: inserts the 'running'
 *                            row BEFORE generation starts (the circuit-breaker
 *                            window counts it) and increments the agent + org
 *                            counters.
 *   recordTaskRunUsage     — accrues tokens/cost onto the run row and the
 *                            task's `totalCostCents` denorm (multiple calls
 *                            per run are fine; failed runs keep their cost).
 *   finalizeTaskAgentRun   — terminal status/outcome, duration, counter
 *                            decrement. The stuck-run sweep flips dead rows
 *                            through here too, so counters never leak.
 *
 * Cost attribution to the org's `usageLedger`/`messageMetadata` is unchanged
 * and happens elsewhere (`on_agent_complete.ts`); these rows are the per-task
 * dimension the ledger lacks.
 */

import { v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import { internalMutation, type MutationCtx } from '../_generated/server';
import {
  checkAgentRunAllowedHelper,
  type CheckAgentRunArgs,
} from '../agents/guardrails/budget_guard';
import { emitEvent } from '../workflows/triggers/emit_event';
import { RUN_STUCK_AFTER_MS } from './constants';
import {
  taskAgentRunOutcomeValidator,
  taskAgentRunStatusValidator,
  taskAgentRunTriggerValidator,
} from './schema';

const ORG_COUNTER_SCOPE = 'org';

function agentCounterScope(agentSlug: string): string {
  return `agent:${agentSlug}`;
}

/** Queued-notice scan bound for the slot-freed wake. */
const QUEUE_PICK_SCAN_CAP = 25;

/**
 * A queued run only deserves a wake while its task can still be worked:
 * present, open, not archived, and not paused by the circuit breaker.
 */
async function isQueuedTaskEligible(
  ctx: MutationCtx,
  organizationId: string,
  taskId: Id<'tasks'> | undefined,
): Promise<boolean> {
  if (!taskId) return false;
  const task = await ctx.db.get(taskId);
  return (
    !!task &&
    task.organizationId === organizationId &&
    !task.archivedAt &&
    task.status !== 'done' &&
    task.status !== 'cancelled' &&
    task.agentRunsPausedAt === undefined
  );
}

/**
 * Close the task's own queue entry once it actually starts — admission IS
 * the queue's consumption point (the wake only re-triggers the run path;
 * whoever wins admission owns the slot).
 */
async function resolveQueuedNoticeForTask(
  ctx: MutationCtx,
  organizationId: string,
  agentSlug: string,
  taskId: Id<'tasks'>,
): Promise<void> {
  const notice = await ctx.db
    .query('agentGuardrailNotices')
    .withIndex('by_org_agent_kind_period', (q) =>
      q
        .eq('organizationId', organizationId)
        .eq('agentSlug', agentSlug)
        .eq('kind', 'concurrency_queued')
        .eq('periodKey', String(taskId)),
    )
    .first();
  if (notice && notice.resolvedAt === undefined) {
    await ctx.db.patch(notice._id, { resolvedAt: Date.now() });
  }
}

/**
 * Slot-freed wake: after a run finalizes (slot decremented), pick the oldest
 * unresolved queued notice — preferring the finished agent's own queue (its
 * per-agent cap definitely freed), falling back to the org-wide oldest (the
 * org cap freed) — resolve it, and emit `agent.slot_freed` for the slot-retry
 * workflow. At most ONE wake per finalize (resolution and emit share this
 * transaction), so a freed slot never fans out into a thundering herd.
 * Dead queue entries (task closed/archived/paused meanwhile) are resolved
 * inline and skipped.
 */
async function wakeOldestQueuedRun(
  ctx: MutationCtx,
  run: Doc<'taskAgentRuns'>,
): Promise<void> {
  const now = Date.now();
  let scanned = 0;
  let sameAgent: Doc<'agentGuardrailNotices'> | null = null;
  let fallback: Doc<'agentGuardrailNotices'> | null = null;

  for await (const notice of ctx.db
    .query('agentGuardrailNotices')
    .withIndex('by_org_kind_resolved', (q) =>
      q
        .eq('organizationId', run.organizationId)
        .eq('kind', 'concurrency_queued')
        .eq('resolvedAt', undefined),
    )) {
    scanned += 1;
    if (scanned > QUEUE_PICK_SCAN_CAP) break;
    if (!(await isQueuedTaskEligible(ctx, run.organizationId, notice.taskId))) {
      await ctx.db.patch(notice._id, { resolvedAt: now });
      continue;
    }
    if (notice.agentSlug === run.agentSlug) {
      sameAgent = notice;
      break; // index order = oldest first; the first same-agent hit wins
    }
    fallback ??= notice;
  }

  const picked = sameAgent ?? fallback;
  if (!picked || !picked.taskId) return;

  await ctx.db.patch(picked._id, { resolvedAt: now });
  await emitEvent(ctx, {
    organizationId: run.organizationId,
    eventType: 'agent.slot_freed',
    eventData: {
      agentSlug: picked.agentSlug,
      taskId: String(picked.taskId),
      projectId: picked.projectId ? String(picked.projectId) : '',
      capScope: picked.capScope ?? 'agent',
    },
  });
}

async function adjustRunCounter(
  ctx: MutationCtx,
  organizationId: string,
  scope: string,
  delta: 1 | -1,
): Promise<void> {
  const now = Date.now();
  const existing = await ctx.db
    .query('agentRunCounters')
    .withIndex('by_org_scope', (q) =>
      q.eq('organizationId', organizationId).eq('scope', scope),
    )
    .first();
  if (!existing) {
    await ctx.db.insert('agentRunCounters', {
      organizationId,
      scope,
      running: Math.max(0, delta),
      updatedAt: now,
    });
    return;
  }
  await ctx.db.patch(existing._id, {
    // Floor at 0: a reconciliation-healed counter must never go negative
    // when a late finalize for an already-recounted run arrives.
    running: Math.max(0, existing.running + delta),
    updatedAt: now,
  });
}

export const startTaskAgentRun = internalMutation({
  args: {
    organizationId: v.string(),
    taskId: v.id('tasks'),
    agentSlug: v.string(),
    trigger: taskAgentRunTriggerValidator,
    wfExecutionId: v.optional(v.id('wfExecutions')),
    workflowSlug: v.optional(v.string()),
    // Workflow step that dispatched this run — with wfExecutionId, the dedup
    // key for the idempotent re-acquire below.
    stepSlug: v.optional(v.string()),
    threadId: v.optional(v.string()),
    // Guardrail inputs from the caller's agent config (this mutation cannot
    // read agent JSON files). The admission re-check below is AUTHORITATIVE —
    // callers' advisory pre-checks can be stale; do not "optimize" it away.
    guardContext: v.optional(
      v.union(
        v.literal('task_run'),
        v.literal('external_enqueue'),
        v.literal('external_claim'),
      ),
    ),
    budget: v.optional(
      v.object({
        monthlyCents: v.number(),
        warnPct: v.optional(v.number()),
        pausePct: v.optional(v.number()),
      }),
    ),
    maxConcurrentTasks: v.optional(v.number()),
  },
  returns: v.object({
    started: v.boolean(),
    runId: v.optional(v.id('taskAgentRuns')),
    reason: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.organizationId !== args.organizationId) {
      return { started: false, reason: 'TASK_NOT_FOUND' };
    }

    // Idempotent re-acquire. A workflow sandbox step that parked on capacity
    // and re-entered (or a DURABLE run handing off across the 10-min action
    // ceiling) calls this again for the SAME (wfExecutionId, stepSlug). Reuse
    // the existing `running` row instead of minting a duplicate and
    // re-incrementing the concurrency counters — the duplication that leaks the
    // `agentRunCounters` semaphore until the org cap wedges EVERY run. The slot
    // was granted on first entry, so skip the admission verdict too. Bounded:
    // an execution has a handful of runs across its life.
    if (args.wfExecutionId && args.stepSlug) {
      for await (const existing of ctx.db
        .query('taskAgentRuns')
        .withIndex('by_wfExecution', (q) =>
          q.eq('wfExecutionId', args.wfExecutionId),
        )) {
        if (
          existing.status === 'running' &&
          existing.stepSlug === args.stepSlug
        ) {
          return { started: true, runId: existing._id };
        }
      }
    }

    const guardArgs: CheckAgentRunArgs = {
      organizationId: args.organizationId,
      agentSlug: args.agentSlug,
      context: args.guardContext ?? 'task_run',
      taskId: args.taskId,
      budget: args.budget,
      maxConcurrentTasks: args.maxConcurrentTasks,
    };
    const verdict = await checkAgentRunAllowedHelper(ctx, guardArgs);
    if (!verdict.allowed) {
      return { started: false, reason: verdict.reason };
    }

    const now = Date.now();
    const runId = await ctx.db.insert('taskAgentRuns', {
      organizationId: args.organizationId,
      projectId: task.projectId,
      taskId: args.taskId,
      agentSlug: args.agentSlug,
      trigger: args.trigger,
      wfExecutionId: args.wfExecutionId,
      workflowSlug: args.workflowSlug,
      stepSlug: args.stepSlug,
      threadId: args.threadId,
      status: 'running',
      inputTokens: 0,
      outputTokens: 0,
      costCents: 0,
      startedAt: now,
    });

    await adjustRunCounter(
      ctx,
      args.organizationId,
      agentCounterScope(args.agentSlug),
      1,
    );
    await adjustRunCounter(ctx, args.organizationId, ORG_COUNTER_SCOPE, 1);

    await ctx.db.patch(args.taskId, {
      agentRunCount: (task.agentRunCount ?? 0) + 1,
      lastAgentRunAt: now,
    });

    await resolveQueuedNoticeForTask(
      ctx,
      args.organizationId,
      args.agentSlug,
      args.taskId,
    );

    return { started: true, runId };
  },
});

export const recordTaskRunUsage = internalMutation({
  args: {
    runId: v.id('taskAgentRuns'),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    costCents: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) {
      console.warn('[AgentTaskRun] recordTaskRunUsage: run not found', {
        runId: args.runId,
      });
      return null;
    }
    const inputTokens = Math.max(0, args.inputTokens ?? 0);
    const outputTokens = Math.max(0, args.outputTokens ?? 0);
    const costCents = Math.max(0, args.costCents ?? 0);
    if (inputTokens === 0 && outputTokens === 0 && costCents === 0) {
      return null;
    }

    await ctx.db.patch(args.runId, {
      inputTokens: run.inputTokens + inputTokens,
      outputTokens: run.outputTokens + outputTokens,
      costCents: run.costCents + costCents,
    });

    if (costCents > 0) {
      const task = await ctx.db.get(run.taskId);
      if (task) {
        await ctx.db.patch(run.taskId, {
          totalCostCents: (task.totalCostCents ?? 0) + costCents,
        });
      }
    }
    return null;
  },
});

async function finalizeRun(
  ctx: MutationCtx,
  run: Doc<'taskAgentRuns'>,
  args: {
    status: 'completed' | 'failed' | 'timed_out';
    outcome?: Doc<'taskAgentRuns'>['outcome'];
    error?: string;
  },
): Promise<void> {
  // Idempotency: a run finalizes exactly once. A second finalize (e.g. the
  // stuck-run sweep racing a slow action's own finalize) must not decrement
  // the counters twice.
  if (run.status !== 'running') return;

  const now = Date.now();
  await ctx.db.patch(run._id, {
    status: args.status,
    outcome: args.outcome,
    error: args.error,
    completedAt: now,
    durationMs: now - run.startedAt,
  });

  await adjustRunCounter(
    ctx,
    run.organizationId,
    agentCounterScope(run.agentSlug),
    -1,
  );
  await adjustRunCounter(ctx, run.organizationId, ORG_COUNTER_SCOPE, -1);

  await wakeOldestQueuedRun(ctx, run);
}

export const finalizeTaskAgentRun = internalMutation({
  args: {
    runId: v.id('taskAgentRuns'),
    status: taskAgentRunStatusValidator,
    outcome: v.optional(taskAgentRunOutcomeValidator),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.status === 'running') {
      console.warn('[AgentTaskRun] finalize called with non-terminal status', {
        runId: args.runId,
      });
      return null;
    }
    const run = await ctx.db.get(args.runId);
    if (!run) {
      console.warn('[AgentTaskRun] finalizeTaskAgentRun: run not found', {
        runId: args.runId,
      });
      return null;
    }
    await finalizeRun(ctx, run, {
      status: args.status,
      outcome: args.outcome,
      error: args.error,
    });
    return null;
  },
});

/**
 * Finalize every still-`running` taskAgentRun for one execution — the terminal-
 * edge cleanup scheduled by `handleWorkflowComplete`. A workflow that completes
 * normally finalizes each run through its own path, but a CANCELLED (or
 * hard-failed) workflow tears down without running it, orphaning the `running`
 * rows so their counter decrement never fires — and the stuck-run sweep only
 * reclaims them an hour later (`RUN_STUCK_AFTER_MS`). Draining them here on the
 * terminal edge is the task-metrics twin of `dropAdmissionTicketsForExecution`.
 * Idempotent via `finalizeRun`'s status guard; bounded by the execution's run
 * count. With `startTaskAgentRun`'s dedup there is now at most one `running` row
 * per (execution, step), so this drains a small, exact set.
 */
export const finalizeRunsForExecution = internalMutation({
  args: {
    wfExecutionId: v.id('wfExecutions'),
    status: taskAgentRunStatusValidator,
    outcome: v.optional(taskAgentRunOutcomeValidator),
    error: v.optional(v.string()),
  },
  returns: v.object({ finalized: v.number() }),
  handler: async (ctx, args) => {
    const status = args.status;
    if (status === 'running') return { finalized: 0 };
    let finalized = 0;
    for await (const run of ctx.db
      .query('taskAgentRuns')
      .withIndex('by_wfExecution', (q) =>
        q.eq('wfExecutionId', args.wfExecutionId),
      )) {
      if (run.status !== 'running') continue;
      await finalizeRun(ctx, run, {
        status,
        outcome: args.outcome,
        error: args.error,
      });
      finalized += 1;
    }
    return { finalized };
  },
});

/**
 * Flip `running` rows whose action died before finalizing to `timed_out`,
 * through the same finalize path so counters decrement. Bounded per call;
 * invoked from the metrics rollup cron (and safe to run ad hoc).
 */
export const recoverStuckTaskRuns = internalMutation({
  args: {
    organizationId: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.object({ recovered: v.number() }),
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    const cutoff = Date.now() - RUN_STUCK_AFTER_MS;
    let recovered = 0;

    const stuck: Doc<'taskAgentRuns'>[] = [];
    for await (const run of ctx.db
      .query('taskAgentRuns')
      .withIndex('by_org_status', (q) =>
        q.eq('organizationId', args.organizationId).eq('status', 'running'),
      )) {
      if (run.startedAt < cutoff) stuck.push(run);
      if (stuck.length >= limit) break;
    }

    for (const run of stuck) {
      await finalizeRun(ctx, run, {
        status: 'timed_out',
        outcome: 'error',
        error: `run exceeded ${RUN_STUCK_AFTER_MS}ms without finalizing`,
      });
      recovered += 1;
    }

    if (recovered > 0) {
      console.warn('[AgentTaskRun] recovered stuck runs', {
        organizationId: args.organizationId,
        recovered,
      });
    }
    return { recovered };
  },
});

/**
 * Guardrail fact gathering + the shared admission check.
 *
 * `checkAgentRunAllowedHelper` works in BOTH query and mutation ctx (reads
 * only): the advisory pre-check in `run_agent_on_task` calls it through the
 * `checkAgentRunAllowed` internal query, and `startTaskAgentRun` re-runs the
 * same helper INSIDE its transaction as the authoritative gate (the advisory
 * verdict can be stale; the mutation-side re-check must never be "optimized
 * away").
 *
 * Per-agent `budget` / `maxConcurrentTasks` come from the CALLER (who holds
 * the file config or `SerializableAgentConfig`) — internal queries cannot
 * read agent JSON files.
 */

import type { GenericQueryCtx } from 'convex/server';
import { v } from 'convex/values';

import type { DataModel, Id } from '../../_generated/dataModel';
import { internalQuery } from '../../_generated/server';
import { buildPeriodKeyFromTimestamp } from '../../governance/helpers';
import {
  evaluateGuardrails,
  type GuardBudget,
  type GuardContext,
  type GuardVerdict,
} from './guard_core';

/** Rolling window for the per-(task, agent) circuit breaker. */
export const TASK_RUN_WINDOW_MS = 60 * 60 * 1000;

/**
 * Deployment-wide guardrail caps. These used to be org-tunable through a
 * retired governance policy; the capacity knobs now ship as fixed defaults,
 * while per-agent `budget` / `maxConcurrentTasks` still come from the agent
 * JSON config.
 */
export const AGENT_GUARDRAIL_DEFAULTS = {
  /** Org-wide cap on concurrently RUNNING agent task runs (internal + external). */
  maxConcurrentRunsOrg: 25,
  /** Per-task circuit breaker: max agent runs per task per rolling hour. */
  maxRunsPerTaskPerHour: 10,
} as const;

async function readRunningCount(
  ctx: GenericQueryCtx<DataModel>,
  organizationId: string,
  scope: string,
): Promise<number> {
  const row = await ctx.db
    .query('agentRunCounters')
    .withIndex('by_org_scope', (q) =>
      q.eq('organizationId', organizationId).eq('scope', scope),
    )
    .first();
  return row?.running ?? 0;
}

async function countTaskRunsInWindow(
  ctx: GenericQueryCtx<DataModel>,
  taskId: Id<'tasks'>,
  agentSlug: string,
  now: number,
): Promise<number> {
  const windowStart = now - TASK_RUN_WINDOW_MS;
  let count = 0;
  for await (const run of ctx.db
    .query('taskAgentRuns')
    .withIndex('by_task_started', (q) =>
      q.eq('taskId', taskId).gt('startedAt', windowStart),
    )) {
    if (run.agentSlug === agentSlug) count += 1;
  }
  return count;
}

export interface CheckAgentRunArgs {
  organizationId: string;
  agentSlug: string;
  context: GuardContext;
  taskId?: Id<'tasks'>;
  budget?: GuardBudget;
  maxConcurrentTasks?: number;
}

export async function checkAgentRunAllowedHelper(
  ctx: GenericQueryCtx<DataModel>,
  args: CheckAgentRunArgs,
): Promise<GuardVerdict> {
  const now = Date.now();

  let monthSpentCents = 0;
  if (args.budget) {
    const monthKey = buildPeriodKeyFromTimestamp('monthly', now);
    for await (const row of ctx.db
      .query('usageLedger')
      .withIndex('by_org_agent_period', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('agentSlug', args.agentSlug)
          .eq('periodKey', monthKey),
      )) {
      monthSpentCents += row.costEstimate;
    }
  }

  const [agentRunning, orgRunning] = await Promise.all([
    readRunningCount(ctx, args.organizationId, `agent:${args.agentSlug}`),
    readRunningCount(ctx, args.organizationId, 'org'),
  ]);

  let taskRunsLastHour: number | undefined;
  let taskPausedAt: number | undefined;
  if (args.taskId) {
    const task = await ctx.db.get(args.taskId);
    taskPausedAt = task?.agentRunsPausedAt;
    taskRunsLastHour = await countTaskRunsInWindow(
      ctx,
      args.taskId,
      args.agentSlug,
      now,
    );
  }

  return evaluateGuardrails(args.context, {
    monthSpentCents,
    budget: args.budget,
    agentRunning,
    agentCap: args.maxConcurrentTasks,
    orgRunning,
    orgCap: AGENT_GUARDRAIL_DEFAULTS.maxConcurrentRunsOrg,
    taskRunsLastHour,
    taskCircuitCap: AGENT_GUARDRAIL_DEFAULTS.maxRunsPerTaskPerHour,
    taskPausedAt,
  });
}

const guardBudgetValidator = v.object({
  monthlyCents: v.number(),
  warnPct: v.optional(v.number()),
  pausePct: v.optional(v.number()),
});

const guardVerdictValidator = v.object({
  allowed: v.boolean(),
  reason: v.optional(
    v.union(
      v.literal('budget_paused'),
      v.literal('task_circuit_breaker'),
      v.literal('agent_concurrency'),
      v.literal('org_concurrency'),
    ),
  ),
  budgetState: v.union(
    v.literal('none'),
    v.literal('ok'),
    v.literal('warn'),
    v.literal('paused'),
  ),
  budgetPct: v.optional(v.number()),
  warningInstruction: v.optional(v.string()),
  queueDepth: v.optional(v.number()),
  monthSpentCents: v.optional(v.number()),
  taskRunsLastHour: v.optional(v.number()),
});

export const checkAgentRunAllowed = internalQuery({
  args: {
    organizationId: v.string(),
    agentSlug: v.string(),
    context: v.union(
      v.literal('task_run'),
      v.literal('delegation'),
      v.literal('external_enqueue'),
      v.literal('external_claim'),
      v.literal('chat_turn'),
    ),
    taskId: v.optional(v.id('tasks')),
    budget: v.optional(guardBudgetValidator),
    maxConcurrentTasks: v.optional(v.number()),
  },
  returns: guardVerdictValidator,
  handler: async (ctx, args) => {
    return await checkAgentRunAllowedHelper(ctx, args);
  },
});

/**
 * The pack contract consumed by the workflow `agent.check_run_budget` op and
 * by mention-response loop guards: per-(task, agent) circuit-breaker state.
 * `alreadyTripped` reflects whether a pending breaker escalation already
 * exists for this (task, agent) so trips stay one-shot.
 */
export const resolveTaskRunBudget = internalQuery({
  args: {
    taskId: v.id('tasks'),
    agentSlug: v.string(),
  },
  returns: v.object({
    allowed: v.boolean(),
    reason: v.optional(v.string()),
    windowRuns: v.number(),
    windowHours: v.number(),
    remaining: v.number(),
    alreadyTripped: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) {
      return {
        allowed: false,
        reason: 'TASK_NOT_FOUND',
        windowRuns: 0,
        windowHours: TASK_RUN_WINDOW_MS / 3_600_000,
        remaining: 0,
        alreadyTripped: false,
      };
    }
    const windowRuns = await countTaskRunsInWindow(
      ctx,
      args.taskId,
      args.agentSlug,
      Date.now(),
    );
    const cap = AGENT_GUARDRAIL_DEFAULTS.maxRunsPerTaskPerHour;

    const tripNotice = await ctx.db
      .query('agentGuardrailNotices')
      .withIndex('by_org_agent_kind_period', (q) =>
        q
          .eq('organizationId', task.organizationId)
          .eq('agentSlug', args.agentSlug)
          .eq('kind', 'circuit_tripped')
          .eq('periodKey', String(args.taskId)),
      )
      .first();

    const paused = task.agentRunsPausedAt !== undefined;
    const atCap = windowRuns >= cap;
    return {
      allowed: !paused && !atCap,
      reason: paused
        ? 'task_circuit_breaker'
        : atCap
          ? 'run_window_exhausted'
          : undefined,
      windowRuns,
      windowHours: TASK_RUN_WINDOW_MS / 3_600_000,
      remaining: Math.max(0, cap - windowRuns),
      alreadyTripped: tripNotice !== null,
    };
  },
});

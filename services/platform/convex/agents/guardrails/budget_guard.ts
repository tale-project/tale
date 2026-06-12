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

import {
  type AgentWorkforceConfig,
  agentWorkforceConfigSchema,
} from '../../../lib/shared/schemas/governance';
import type { DataModel, Id } from '../../_generated/dataModel';
import { internalQuery } from '../../_generated/server';
import {
  buildPeriodKeyFromTimestamp,
  readPolicyConfig,
} from '../../governance/helpers';
import {
  evaluateGuardrails,
  type GuardBudget,
  type GuardContext,
  type GuardVerdict,
} from './guard_core';

/** Rolling window for the per-(task, agent) circuit breaker. */
export const TASK_RUN_WINDOW_MS = 60 * 60 * 1000;

/** Schema defaults applied when the org has no `agent_workforce` policy row. */
export const DEFAULT_AGENT_WORKFORCE: AgentWorkforceConfig =
  agentWorkforceConfigSchema.parse({ enabled: true });

export async function readAgentWorkforcePolicy(
  ctx: GenericQueryCtx<DataModel>,
  organizationId: string,
): Promise<AgentWorkforceConfig> {
  const raw = await readPolicyConfig<unknown>(
    ctx,
    organizationId,
    'agent_workforce',
  );
  if (!raw) return DEFAULT_AGENT_WORKFORCE;
  const parsed = agentWorkforceConfigSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn(
      '[Guardrails] invalid agent_workforce policy; using defaults',
      {
        organizationId,
      },
    );
    return DEFAULT_AGENT_WORKFORCE;
  }
  return parsed.data;
}

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
  // `policy.enabled === false` disables the capacity knobs (concurrency,
  // circuit breaker) via unlimited caps below — budget still applies
  // everywhere (spend authority is not a capacity knob).
  const policy = await readAgentWorkforcePolicy(ctx, args.organizationId);

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
    agentCap: policy.enabled
      ? (args.maxConcurrentTasks ?? policy.defaultAgentMaxConcurrentTasks)
      : undefined,
    orgRunning,
    orgCap: policy.enabled
      ? policy.maxConcurrentRunsOrg
      : Number.MAX_SAFE_INTEGER,
    taskRunsLastHour,
    taskCircuitCap: policy.enabled
      ? policy.maxRunsPerTaskPerHour
      : Number.MAX_SAFE_INTEGER,
    taskPausedAt: policy.enabled ? taskPausedAt : undefined,
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
    const policy = await readAgentWorkforcePolicy(ctx, task.organizationId);
    const windowRuns = await countTaskRunsInWindow(
      ctx,
      args.taskId,
      args.agentSlug,
      Date.now(),
    );
    const cap = policy.enabled
      ? policy.maxRunsPerTaskPerHour
      : Number.MAX_SAFE_INTEGER;

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

/**
 * Per-agent guardrail snapshots for the organigram / workforce surfaces:
 * month-to-date spend, currently-running task count, and whether the budget
 * pause notice exists for this month. One bounded read set per agent;
 * callers cap the slug list.
 */
export const getWorkforceSnapshots = internalQuery({
  args: {
    organizationId: v.string(),
    agentSlugs: v.array(v.string()),
  },
  returns: v.array(
    v.object({
      slug: v.string(),
      monthSpentCents: v.number(),
      running: v.number(),
      budgetPaused: v.boolean(),
    }),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<
    Array<{
      slug: string;
      monthSpentCents: number;
      running: number;
      budgetPaused: boolean;
    }>
  > => {
    const monthKey = buildPeriodKeyFromTimestamp('monthly', Date.now());
    const slugs = [...new Set(args.agentSlugs)].slice(0, 100);
    const rows: Array<{
      slug: string;
      monthSpentCents: number;
      running: number;
      budgetPaused: boolean;
    }> = [];
    for (const slug of slugs) {
      let monthSpentCents = 0;
      for await (const row of ctx.db
        .query('usageLedger')
        .withIndex('by_org_agent_period', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('agentSlug', slug)
            .eq('periodKey', monthKey),
        )) {
        monthSpentCents += row.costEstimate;
      }
      const counter = await ctx.db
        .query('agentRunCounters')
        .withIndex('by_org_scope', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('scope', `agent:${slug}`),
        )
        .first();
      const pausedNotice = await ctx.db
        .query('agentGuardrailNotices')
        .withIndex('by_org_agent_kind_period', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('agentSlug', slug)
            .eq('kind', 'budget_paused')
            .eq('periodKey', monthKey),
        )
        .first();
      rows.push({
        slug,
        monthSpentCents,
        running: counter?.running ?? 0,
        budgetPaused: pausedNotice !== null,
      });
    }
    return rows;
  },
});

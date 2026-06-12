/**
 * Side-effecting guardrail actions. Every one is idempotent through the
 * `agentGuardrailNotices` ledger: a notice row's existence IS the dedupe,
 * so threshold crossings notify exactly once per scope (per agent-month for
 * budget kinds, per task for breaker/queue kinds) no matter how many racing
 * runs observe the same condition.
 */

import { v } from 'convex/values';

import { internal } from '../../_generated/api';
import type { Doc, Id } from '../../_generated/dataModel';
import { internalMutation, type MutationCtx } from '../../_generated/server';
import { createAuditLog } from '../../audit_logs/helpers';
import { buildPeriodKeyFromTimestamp } from '../../governance/helpers';
import { writeNotificationForOrgs } from '../../notifications/helpers';
import { emitEvent } from '../../workflows/triggers/emit_event';

type NoticeKind = Doc<'agentGuardrailNotices'>['kind'];

/**
 * Check-then-insert on the dedupe index. Returns true when this call
 * created the notice (i.e. the caller owns the side effects).
 */
async function insertNoticeIfAbsent(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    agentSlug: string;
    kind: NoticeKind;
    periodKey: string;
    thresholdPct?: number;
    taskId?: Id<'tasks'>;
    projectId?: Id<'projects'>;
    capScope?: string;
  },
): Promise<boolean> {
  const existing = await ctx.db
    .query('agentGuardrailNotices')
    .withIndex('by_org_agent_kind_period', (q) =>
      q
        .eq('organizationId', args.organizationId)
        .eq('agentSlug', args.agentSlug)
        .eq('kind', args.kind)
        .eq('periodKey', args.periodKey),
    )
    .first();
  // For queue notices, an unresolved row blocks re-queueing; a resolved one
  // (the task was woken before) may be superseded by a fresh queue entry.
  if (
    existing &&
    (args.kind !== 'concurrency_queued' || !existing.resolvedAt)
  ) {
    return false;
  }
  await ctx.db.insert('agentGuardrailNotices', {
    organizationId: args.organizationId,
    agentSlug: args.agentSlug,
    kind: args.kind,
    periodKey: args.periodKey,
    thresholdPct: args.thresholdPct,
    taskId: args.taskId,
    projectId: args.projectId,
    capScope: args.capScope,
    createdAt: Date.now(),
  });
  return true;
}

export const recordBudgetWarnCrossing = internalMutation({
  args: {
    organizationId: v.string(),
    agentSlug: v.string(),
    budgetPct: v.number(),
    spentCents: v.number(),
    monthlyCents: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const periodKey = buildPeriodKeyFromTimestamp('monthly', Date.now());
    const created = await insertNoticeIfAbsent(ctx, {
      organizationId: args.organizationId,
      agentSlug: args.agentSlug,
      kind: 'budget_warn',
      periodKey,
      thresholdPct: args.budgetPct,
    });
    if (!created) return null;

    await writeNotificationForOrgs(ctx, {
      organizationIds: [args.organizationId],
      category: 'system',
      severity: 'warning',
      titleKey: 'agentBudgetWarnTitle',
      bodyKey: 'agentBudgetWarnBody',
      params: {
        agentSlug: args.agentSlug,
        pct: args.budgetPct,
        spentCents: args.spentCents,
        monthlyCents: args.monthlyCents,
      },
    });
    return null;
  },
});

export const recordBudgetPause = internalMutation({
  args: {
    organizationId: v.string(),
    agentSlug: v.string(),
    spentCents: v.number(),
    monthlyCents: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const now = Date.now();
    const periodKey = buildPeriodKeyFromTimestamp('monthly', now);
    const created = await insertNoticeIfAbsent(ctx, {
      organizationId: args.organizationId,
      agentSlug: args.agentSlug,
      kind: 'budget_paused',
      periodKey,
    });
    if (!created) return null;

    await writeNotificationForOrgs(ctx, {
      organizationIds: [args.organizationId],
      category: 'system',
      severity: 'critical',
      titleKey: 'agentBudgetExceededTitle',
      bodyKey: 'agentBudgetExceededBody',
      params: {
        agentSlug: args.agentSlug,
        spentCents: args.spentCents,
        monthlyCents: args.monthlyCents,
      },
    });
    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: 'system',
      actorType: 'system',
      action: 'agent.budget_blocked',
      category: 'ai',
      resourceType: 'agent',
      resourceId: args.agentSlug,
      metadata: {
        spentCents: args.spentCents,
        monthlyCents: args.monthlyCents,
        periodKey,
      },
      status: 'success',
    });
    // Exactly-once per agent-month (gated by the notice above): the
    // budget-reassign pack workflow consumes this to clear the agent's queue.
    await emitEvent(ctx, {
      organizationId: args.organizationId,
      eventType: 'agent.budget_exceeded',
      eventData: {
        agentSlug: args.agentSlug,
        spentCents: args.spentCents,
        monthlyCents: args.monthlyCents,
        periodKey,
      },
    });
    return null;
  },
});

/**
 * Queue a task refused on a concurrency cap. The unresolved notice doubles
 * as the FIFO entry the slot-freed wake consumes; the explanatory comment
 * goes through `agentAddComment` so it renders like any agent activity.
 */
export const enqueueBlockedRun = internalMutation({
  args: {
    organizationId: v.string(),
    agentSlug: v.string(),
    taskId: v.id('tasks'),
    capScope: v.string(),
    queueDepth: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.organizationId !== args.organizationId) return null;
    const created = await insertNoticeIfAbsent(ctx, {
      organizationId: args.organizationId,
      agentSlug: args.agentSlug,
      kind: 'concurrency_queued',
      periodKey: String(args.taskId),
      taskId: args.taskId,
      projectId: task.projectId,
      capScope: args.capScope,
    });
    if (!created) return null;

    const depth =
      args.queueDepth !== undefined ? ` (${args.queueDepth} running)` : '';
    await ctx.runMutation(internal.tasks.internal_mutations.agentAddComment, {
      organizationId: args.organizationId,
      actorId: 'workflow',
      taskId: args.taskId,
      body: `[automated] ⏸ Queued: ${args.agentSlug} is at its concurrency limit${depth}. This task will start automatically when a slot frees.`,
    });
    return null;
  },
});

export const tripTaskCircuitBreaker = internalMutation({
  args: {
    organizationId: v.string(),
    agentSlug: v.string(),
    taskId: v.id('tasks'),
    windowRuns: v.number(),
    windowHours: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.organizationId !== args.organizationId) return null;
    const created = await insertNoticeIfAbsent(ctx, {
      organizationId: args.organizationId,
      agentSlug: args.agentSlug,
      kind: 'circuit_tripped',
      periodKey: String(args.taskId),
      taskId: args.taskId,
      projectId: task.projectId,
    });
    if (!created) return null;

    const now = Date.now();
    if (task.agentRunsPausedAt === undefined) {
      await ctx.db.patch(args.taskId, {
        agentRunsPausedAt: now,
        agentRunsPausedReason: `circuit_breaker:${args.agentSlug}`,
      });
    }
    await ctx.runMutation(internal.tasks.internal_mutations.agentAddComment, {
      organizationId: args.organizationId,
      actorId: 'workflow',
      taskId: args.taskId,
      body: `[automated] ⛔ Agent runs paused on this task: ${args.agentSlug} reached ${args.windowRuns} runs in ${args.windowHours}h (safety limit). A human must change the task status to resume automation.`,
    });
    await writeNotificationForOrgs(ctx, {
      organizationIds: [args.organizationId],
      category: 'system',
      severity: 'warning',
      titleKey: 'agentCircuitTrippedTitle',
      bodyKey: 'agentCircuitTrippedBody',
      params: {
        agentSlug: args.agentSlug,
        taskTitle: task.title,
        windowRuns: args.windowRuns,
        windowHours: args.windowHours,
      },
    });
    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: 'system',
      actorType: 'system',
      action: 'agent.circuit_breaker_tripped',
      category: 'ai',
      resourceType: 'task',
      resourceId: String(args.taskId),
      resourceName: task.title,
      metadata: {
        agentSlug: args.agentSlug,
        windowRuns: args.windowRuns,
        windowHours: args.windowHours,
      },
      status: 'success',
    });
    return null;
  },
});

/**
 * Lost-event backstop for the slot-freed wake: re-emit `agent.slot_freed`
 * for unresolved queue entries older than `olderThanMinutes`. Does NOT
 * resolve them — admission (`startTaskAgentRun`) is the queue's consumption
 * point, so a re-emitted task that loses the race simply stays queued for
 * the next wake. Dead entries (task closed/archived/paused) are resolved
 * inline instead. Driven by the hourly stale-work-sweep workflow.
 */
export const requeueStaleQueuedNotices = internalMutation({
  args: {
    organizationId: v.string(),
    olderThanMinutes: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.object({ reEmitted: v.number(), cleaned: v.number() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ reEmitted: number; cleaned: number }> => {
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 50);
    const now = Date.now();
    const cutoff = now - (args.olderThanMinutes ?? 15) * 60 * 1000;
    let reEmitted = 0;
    let cleaned = 0;

    for await (const notice of ctx.db
      .query('agentGuardrailNotices')
      .withIndex('by_org_kind_resolved', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('kind', 'concurrency_queued')
          .eq('resolvedAt', undefined),
      )) {
      if (notice.createdAt >= cutoff) continue;
      if (reEmitted + cleaned >= limit) break;

      const task = notice.taskId ? await ctx.db.get(notice.taskId) : null;
      const eligible =
        !!task &&
        task.organizationId === args.organizationId &&
        !task.archivedAt &&
        task.status !== 'done' &&
        task.status !== 'cancelled' &&
        task.agentRunsPausedAt === undefined;
      if (!eligible) {
        await ctx.db.patch(notice._id, { resolvedAt: now });
        cleaned += 1;
        continue;
      }

      await emitEvent(ctx, {
        organizationId: args.organizationId,
        eventType: 'agent.slot_freed',
        eventData: {
          agentSlug: notice.agentSlug,
          taskId: String(notice.taskId),
          projectId: notice.projectId ? String(notice.projectId) : '',
          capScope: notice.capScope ?? 'agent',
        },
      });
      reEmitted += 1;
    }
    return { reEmitted, cleaned };
  },
});

/**
 * Clears the breaker ledger when a human resumes a paused task (the task
 * field reset itself happens inline in the human status mutations).
 */
export const clearTaskCircuitBreaker = internalMutation({
  args: { taskId: v.id('tasks') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) return null;
    const now = Date.now();
    for await (const notice of ctx.db
      .query('agentGuardrailNotices')
      .withIndex('by_org_kind_resolved', (q) =>
        q
          .eq('organizationId', task.organizationId)
          .eq('kind', 'circuit_tripped')
          .eq('resolvedAt', undefined),
      )) {
      if (String(notice.taskId) === String(args.taskId)) {
        await ctx.db.patch(notice._id, { resolvedAt: now });
      }
    }
    return null;
  },
});

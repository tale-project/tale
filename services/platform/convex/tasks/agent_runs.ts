import { v } from 'convex/values';

import { internalMutation, internalQuery } from '../_generated/server';

/**
 * Run-row internals for task agent runs — the small, transactional pieces the
 * node host (`tasks/agent_run_host.ts`) orchestrates around. The host owns
 * the once-only settle claim (the session-op finalize election); these
 * mutations just record state, each tolerant of a terminal row so a raced
 * caller degrades to a no-op instead of resurrecting a finished run.
 *
 * The public kick/cancel doors live in `tasks/mutations.ts` (they share its
 * auth/guard helpers); the board-facing read lives in `tasks/queries.ts`.
 */

const TERMINAL_RUN_STATUSES = new Set(['settled', 'failed', 'cancelled']);

/** Wall-clock one task-agent turn may run — same knob as the automation
 * agent lane (one harness turn is one product concept). V8-safe read; the
 * node host enforces it in the drive loop. */
export function taskAgentDeadlineMs(): number {
  const raw = Number(process.env.TALE_AUTOMATION_AGENT_DEADLINE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 30 * 60_000;
}

export const getTaskAgentRunForDrive = internalQuery({
  args: { runId: v.id('projectAgentRuns') },
  returns: v.union(
    v.object({
      status: v.string(),
      execId: v.string(),
      sessionId: v.string(),
      organizationId: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;
    return {
      status: run.status,
      execId: run.execId,
      sessionId: run.sessionId,
      organizationId: run.organizationId,
    };
  },
});

/** Everything the node host needs to phrase the turn's prompt. Comment
 * history is a follow-up: comment text lives in the agent component store,
 * so v1 briefs carry the task fields only. */
export const getTaskBriefForAgentRun = internalQuery({
  args: { taskId: v.id('tasks') },
  returns: v.union(
    v.object({
      title: v.string(),
      description: v.optional(v.string()),
      labels: v.optional(v.array(v.string())),
      identifier: v.optional(v.string()),
      projectName: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) return null;
    const project = await ctx.db.get(task.projectId);
    const identifier =
      project?.key !== undefined && task.number !== undefined
        ? `${project.key}-${task.number}`
        : undefined;
    return {
      title: task.title,
      ...(task.description !== undefined
        ? { description: task.description }
        : {}),
      ...(task.labels !== undefined ? { labels: task.labels } : {}),
      ...(identifier !== undefined ? { identifier } : {}),
      ...(project !== null ? { projectName: project.name } : {}),
    };
  },
});

export const setTaskAgentRunRunning = internalMutation({
  args: { runId: v.id('projectAgentRuns') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || TERMINAL_RUN_STATUSES.has(run.status)) return null;
    await ctx.db.patch(args.runId, {
      status: 'running',
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const markTaskAgentRunSettled = internalMutation({
  args: {
    runId: v.id('projectAgentRuns'),
    resultText: v.string(),
    resultMessageId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || TERMINAL_RUN_STATUSES.has(run.status)) return null;
    const now = Date.now();
    await ctx.db.patch(args.runId, {
      status: 'settled',
      resultText: args.resultText,
      ...(args.resultMessageId !== undefined
        ? { resultMessageId: args.resultMessageId }
        : {}),
      settledAt: now,
      updatedAt: now,
    });
    return null;
  },
});

export const markTaskAgentRunFailed = internalMutation({
  args: { runId: v.id('projectAgentRuns'), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || TERMINAL_RUN_STATUSES.has(run.status)) return null;
    const now = Date.now();
    await ctx.db.patch(args.runId, {
      status: 'failed',
      error: args.error,
      settledAt: now,
      updatedAt: now,
    });
    return null;
  },
});

export const markTaskAgentRunCancelled = internalMutation({
  args: { runId: v.id('projectAgentRuns') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || TERMINAL_RUN_STATUSES.has(run.status)) return null;
    const now = Date.now();
    await ctx.db.patch(args.runId, {
      status: 'cancelled',
      settledAt: now,
      updatedAt: now,
    });
    return null;
  },
});

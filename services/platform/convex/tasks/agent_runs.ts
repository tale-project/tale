import { v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { internalMutation, internalQuery } from '../_generated/server';
import { recordTaskAgentRunLedgerEntry } from '../audit_logs/agent_run_ledger';
import { sessionOpLastSignOfLifeMs } from '../sandbox/agent_deadline';
import { readTaskDiscussionMessages } from './internal_queries';
import {
  resolveTaskKickResume,
  type KickResumePrevious,
} from './task_kick_resume';

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

/** The brief carries at most this tail of the task discussion, each message
 * clipped, so a long thread cannot flood the turn's prompt. The tail always
 * spans the previous run's report and the review that followed it — the two
 * messages a rerun must not lose. */
const BRIEF_DISCUSSION_MAX_MESSAGES = 10;
const BRIEF_DISCUSSION_MAX_MESSAGE_CHARS = 2000;

function clipDiscussionBody(body: string): string {
  if (body.length <= BRIEF_DISCUSSION_MAX_MESSAGE_CHARS) return body;
  return `${body.slice(0, BRIEF_DISCUSSION_MAX_MESSAGE_CHARS)}\n… (truncated)`;
}

/** Everything the node host needs to phrase the turn's prompt and stage the
 * task's inputs: the task fields, a bounded tail of the discussion (a fresh
 * conversation's only memory of earlier runs; a RESUMED conversation gets
 * just the entries newer than its predecessor's settle, filtered by `at`),
 * and the blob refs of the user's attachments and the task's current
 * deliverables. */
export const getTaskBriefForAgentRun = internalQuery({
  args: { taskId: v.id('tasks') },
  returns: v.union(
    v.object({
      title: v.string(),
      description: v.optional(v.string()),
      labels: v.optional(v.array(v.string())),
      identifier: v.optional(v.string()),
      projectName: v.optional(v.string()),
      discussion: v.array(
        v.object({
          author: v.union(v.literal('user'), v.literal('agent')),
          body: v.string(),
          at: v.number(),
        }),
      ),
      attachments: v.array(
        v.object({ fileId: v.string(), fileName: v.string() }),
      ),
      outputs: v.array(v.object({ fileId: v.string(), fileName: v.string() })),
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
    const discussion = (await readTaskDiscussionMessages(ctx, task))
      .slice(-BRIEF_DISCUSSION_MAX_MESSAGES)
      .map((message) => ({
        author:
          message.authorType === 'user'
            ? ('user' as const)
            : ('agent' as const),
        body: clipDiscussionBody(message.body),
        at: message.createdAt,
      }));
    const labelNames: string[] = [];
    if (task.labelIds && task.labelIds.length > 0) {
      for (const id of task.labelIds) {
        const label = await ctx.db.get(id);
        if (label) labelNames.push(label.name);
      }
    } else if (task.labels && task.labels.length > 0) {
      labelNames.push(...task.labels);
    }
    return {
      title: task.title,
      ...(task.description !== undefined
        ? { description: task.description }
        : {}),
      ...(labelNames.length > 0 ? { labels: labelNames } : {}),
      ...(identifier !== undefined ? { identifier } : {}),
      ...(project !== null ? { projectName: project.name } : {}),
      discussion,
      attachments: (task.attachments ?? []).map((attachment) => ({
        fileId: String(attachment.fileId),
        fileName: attachment.fileName,
      })),
      outputs: (task.outputs ?? []).map((output) => ({
        fileId: String(output.fileId),
        fileName: output.fileName,
      })),
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
    /** The settling exec. A run can outlive an exec (the restart-steering
     * lane rotates it under a live run), so a mark from a superseded chain
     * must be a no-op — without the guard, the killed chain's own settle
     * would terminal-stamp a run now working on its next incarnation. */
    execId: v.optional(v.string()),
    /** The harness conversation id the turn announced — stamped with the
     * terminal flip so a later kick of the same task can `--resume` it
     * (`resolveTaskKickResume`). The host withholds it from launch-failure
     * windows, so a dead handle a CLI echoed back never re-arms. */
    agentSessionId: v.optional(v.string()),
    /** `sandboxSessions.createdAt` of the incarnation the turn ran on —
     * stamped only alongside the handle. */
    sessionCreatedAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || TERMINAL_RUN_STATUSES.has(run.status)) return null;
    if (args.execId !== undefined && run.execId !== args.execId) return null;
    const now = Date.now();
    await ctx.db.patch(args.runId, {
      status: 'settled',
      resultText: args.resultText,
      ...(args.resultMessageId !== undefined
        ? { resultMessageId: args.resultMessageId }
        : {}),
      ...(args.agentSessionId !== undefined
        ? {
            agentSessionId: args.agentSessionId,
            ...(args.sessionCreatedAt !== undefined
              ? { sessionCreatedAt: args.sessionCreatedAt }
              : {}),
          }
        : {}),
      settledAt: now,
      updatedAt: now,
    });
    // Provenance ledger, atomic with the settle: the guards above (first-wins
    // on TERMINAL_RUN_STATUSES + the exec fence) admit exactly one terminal
    // flip per run, so a raced sibling mark no-ops before reaching here and
    // never writes a second entry.
    await recordTaskAgentRunLedgerEntry(ctx, {
      run,
      finalStatus: 'settled',
      settledAt: now,
    });
    return null;
  },
});

export const markTaskAgentRunFailed = internalMutation({
  args: {
    runId: v.id('projectAgentRuns'),
    error: v.string(),
    /** See markTaskAgentRunSettled — a superseded exec's mark is a no-op. */
    execId: v.optional(v.string()),
    /** See markTaskAgentRunSettled — a failed turn's conversation is still
     * resumable (the standing workspace holds its state), so the handle is
     * stamped here too. */
    agentSessionId: v.optional(v.string()),
    sessionCreatedAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || TERMINAL_RUN_STATUSES.has(run.status)) return null;
    if (args.execId !== undefined && run.execId !== args.execId) return null;
    const now = Date.now();
    await ctx.db.patch(args.runId, {
      status: 'failed',
      error: args.error,
      ...(args.agentSessionId !== undefined
        ? {
            agentSessionId: args.agentSessionId,
            ...(args.sessionCreatedAt !== undefined
              ? { sessionCreatedAt: args.sessionCreatedAt }
              : {}),
          }
        : {}),
      settledAt: now,
      updatedAt: now,
    });
    // Provenance ledger — same exactly-once reasoning as the settled mark:
    // this mutation's terminal-status + exec guards are the once-only claim.
    await recordTaskAgentRunLedgerEntry(ctx, {
      run,
      finalStatus: 'failed',
      settledAt: now,
      error: args.error,
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
    // Provenance ledger — same exactly-once reasoning as the settled mark.
    await recordTaskAgentRunLedgerEntry(ctx, {
      run,
      finalStatus: 'cancelled',
      settledAt: now,
    });
    return null;
  },
});

/** Scan cap for the stalled-turn sweep — matches the automations watchdog. */
const STALLED_RUN_SCAN_LIMIT = 100;

/**
 * The task-agent watchdog's work list: live runs whose turn nobody is
 * draining. The run row is the durable record (written BEFORE the start
 * action is scheduled), so it is the scan root; the op row supplies the
 * liveness signal — a drive chain bumps its heartbeat every window, so a
 * stale heartbeat, or no op row at all (a start that died before writing
 * it), means the chain is gone. A terminal op is skipped: its settle is the
 * host's to finish, not the watchdog's.
 */
export const listStalledTaskAgentTurns = internalQuery({
  args: { staleBeforeMs: v.number(), limit: v.number() },
  returns: v.array(
    v.object({
      organizationId: v.string(),
      runId: v.id('projectAgentRuns'),
      taskId: v.id('tasks'),
      agentId: v.id('projectAgents'),
      execId: v.string(),
      sessionId: v.string(),
      harness: v.string(),
      deadlineAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const out = [];
    let scanned = 0;
    for (const status of ['queued', 'running'] as const) {
      for await (const run of ctx.db
        .query('projectAgentRuns')
        .withIndex('by_status', (q) => q.eq('status', status))
        .order('desc')) {
        if (out.length >= args.limit) break;
        if (++scanned > STALLED_RUN_SCAN_LIMIT) break;
        const op = await ctx.db
          .query('sandboxSessionOps')
          .withIndex('by_sessionId_and_execId', (q) =>
            q.eq('sessionId', run.sessionId).eq('execId', run.execId),
          )
          .first();
        // Parked on capacity: nothing is (or should be) draining this run —
        // the wake/retry lane owns it. Reaping it here would manufacture an
        // op row and kill it with a wrong reason.
        if (run.waitingForCapacityAt !== undefined) continue;
        if (op !== null) {
          // ONE liveness rule for every phase: the op's lease must be silent
          // past the staleness window. The drain bumps it per attach window,
          // the finalize claim and the per-file harvest bumps carry it
          // through the settle, the terminal write stamps `finishedAt`. An
          // op that settled while the RUN never did is a mid-settle death —
          // it goes stale here like any other dead chain, and the
          // re-attached chain's settle fallback (`!release.won` +
          // first-wins marks) finishes the run side.
          if (sessionOpLastSignOfLifeMs(op) >= args.staleBeforeMs) continue;
        } else if (
          Math.max(run.startedAt, run.updatedAt) >= args.staleBeforeMs
        ) {
          // No op row yet, but the start was scheduled moments ago — give it
          // the same staleness window before calling it dead. `updatedAt`
          // covers a wake of a LONG-parked run: the park claim clears the
          // capacity shield and bumps `updatedAt`, while `startedAt` (kick
          // time) is stale — on `startedAt` alone this sweep would fabricate
          // an op row and fail the run while its restart is mid-flight.
          continue;
        }
        out.push({
          organizationId: run.organizationId,
          runId: run._id,
          taskId: run.taskId,
          agentId: run.agentId,
          execId: run.execId,
          sessionId: run.sessionId,
          harness: run.harness,
          deadlineAt: run.deadlineAt,
        });
      }
      if (out.length >= args.limit) break;
    }
    return out;
  },
});

/**
 * Swap a LIVE run onto a fresh exec incarnation — the restart-steering lane
 * (a non-steerable harness absorbing a mid-run comment) kills the exec and
 * continues the run on a new one. The swap IS the single-winner claim:
 * guarded on (status `running`, execId === fromExecId), so a raced settle,
 * cancel, or sibling steer can never double-rotate. The superseded chain
 * then orphans itself — its settle marks are exec-guarded and the session
 * slot release refuses while the incarnation's op runs. The new id chains
 * `-2` onto the old, which keeps the run's op reads following it
 * (`getTaskAgentRunSandboxOp` matches `${execId}-` prefixes).
 */
export const rotateTaskAgentRunExec = internalMutation({
  args: { runId: v.id('projectAgentRuns'), fromExecId: v.string() },
  returns: v.union(v.object({ execId: v.string() }), v.null()),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status !== 'running' || run.execId !== args.fromExecId) {
      return null;
    }
    const execId = `${args.fromExecId}-2`;
    await ctx.db.patch(args.runId, { execId, updatedAt: Date.now() });
    return { execId };
  },
});

/**
 * Stamp a run as PARKED on sandbox capacity — the org's session budget was
 * full when the start tried to reserve a slot. The run stays `queued` (the
 * card keeps reading "Queued", which is true); the stamp is what routes it to
 * the wake/retry lane and shields it from the stalled-turn reaper. Guarded on
 * (queued, execId) so a raced settle/cancel can never un-terminal a run.
 */
export const parkTaskAgentRunForCapacity = internalMutation({
  args: { runId: v.id('projectAgentRuns'), execId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status !== 'queued' || run.execId !== args.execId) {
      return null;
    }
    await ctx.db.patch(args.runId, {
      waitingForCapacityAt: Date.now(),
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Claim a parked run for a restart attempt: clearing the stamp IS the
 * single-winner election — the release-edge wake and the watchdog backstop
 * both claim before scheduling, so one run never gets two concurrent starts
 * (a double start would mint two gateway keys and two execs; the spawner
 * does not dedupe execIds). A failed restart re-parks, re-arming the claim.
 */
export const claimParkedTaskAgentRun = internalMutation({
  args: { runId: v.id('projectAgentRuns'), execId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.status !== 'queued' ||
      run.execId !== args.execId ||
      run.waitingForCapacityAt === undefined
    ) {
      return false;
    }
    await ctx.db.patch(args.runId, {
      waitingForCapacityAt: undefined,
      updatedAt: Date.now(),
    });
    return true;
  },
});

/** The watchdog's parked-run work list: oldest first, org-agnostic. */
export const listParkedTaskAgentRuns = internalQuery({
  args: { limit: v.number() },
  returns: v.array(
    v.object({
      organizationId: v.string(),
      runId: v.id('projectAgentRuns'),
      execId: v.string(),
      deadlineAt: v.number(),
      waitingForCapacityAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const out = [];
    let scanned = 0;
    for await (const run of ctx.db
      .query('projectAgentRuns')
      .withIndex('by_status', (q) => q.eq('status', 'queued'))) {
      if (out.length >= args.limit || ++scanned > STALLED_RUN_SCAN_LIMIT) {
        break;
      }
      if (run.waitingForCapacityAt === undefined) continue;
      out.push({
        organizationId: run.organizationId,
        runId: run._id,
        execId: run.execId,
        deadlineAt: run.deadlineAt,
        waitingForCapacityAt: run.waitingForCapacityAt,
      });
    }
    return out;
  },
});

/** How many of the task's newest run rows the kick-resume predecessor walk
 * may touch before giving up (treating the task as first-start). Matches the
 * house bounded-scan style; a task with this many consecutive never-launched
 * terminal rows is already pathological. */
const KICK_RESUME_PREDECESSOR_SCAN_LIMIT = 15;

/** The start-shaping args a kick decision produces — spread verbatim into the
 * scheduled `startTaskAgentTurn` by both schedulers. */
export interface TaskKickStartArgs {
  resume?: string;
  resumeSessionCreatedAt?: number;
  resumeDiscussionSince?: number;
  sweep: boolean;
  inspectNote: boolean;
}

/**
 * The db half of the kick-resume decision, shared by `kickTaskAgentRun` and
 * `wakeParkedTaskAgentRuns` so the rule can never drift between the two
 * start schedulers: read the live standing-session incarnation, find the
 * task's latest terminal run BY THIS AGENT that actually launched an exec
 * (a start that died before spawning — no handle, no op row — says nothing
 * about the box or the conversation and is skipped; so is another agent's
 * run, whose box lives in another session), recover a pre-stamp handle from
 * that run's own session op, and feed the pure decision
 * (`resolveTaskKickResume`). A parked run being woken is `queued`, so the
 * terminal-only walk naturally decides on its predecessor, never on itself.
 */
export async function resolveTaskKickStartArgs(
  ctx: QueryCtx,
  args: {
    taskId: Id<'tasks'>;
    agentId: Id<'projectAgents'>;
    harness: string;
    sessionId: string;
  },
): Promise<TaskKickStartArgs> {
  let liveSessionCreatedAt: number | undefined;
  for await (const row of ctx.db
    .query('sandboxSessions')
    .withIndex('by_owner', (q) =>
      q.eq('ownerType', 'project_agent').eq('ownerId', String(args.agentId)),
    )) {
    if (
      row.status === 'creating' ||
      row.status === 'active' ||
      row.status === 'stopped'
    ) {
      liveSessionCreatedAt = row.createdAt;
      break;
    }
  }

  let previous: (KickResumePrevious & { settledAt?: number }) | null = null;
  let scanned = 0;
  for await (const run of ctx.db
    .query('projectAgentRuns')
    .withIndex('by_task', (q) => q.eq('taskId', args.taskId))
    .order('desc')) {
    if (++scanned > KICK_RESUME_PREDECESSOR_SCAN_LIMIT) break;
    if (
      run.status !== 'settled' &&
      run.status !== 'failed' &&
      run.status !== 'cancelled'
    ) {
      continue;
    }
    if (String(run.agentId) !== String(args.agentId)) continue;
    let handle = run.agentSessionId;
    if (handle === undefined) {
      // Rows predating the stamp (or cancelled before their settle could
      // stamp): the run's own op row still holds the handle its windows
      // captured. Point read on the run's OWN (sessionId, execId) — never a
      // session-wide scan, which could surface a sibling task's conversation.
      const op = await ctx.db
        .query('sandboxSessionOps')
        .withIndex('by_sessionId_and_execId', (q) =>
          q.eq('sessionId', run.sessionId).eq('execId', run.execId),
        )
        .first();
      if (op === null) continue; // never launched — inert, look further back
      handle = op.agentSessionId;
    }
    previous = {
      status: run.status,
      agentId: String(run.agentId),
      harness: run.harness,
      sessionId: run.sessionId,
      startedAt: run.startedAt,
      ...(handle !== undefined ? { agentSessionId: handle } : {}),
      ...(run.sessionCreatedAt !== undefined
        ? { sessionCreatedAt: run.sessionCreatedAt }
        : {}),
      ...(run.settledAt !== undefined ? { settledAt: run.settledAt } : {}),
    };
    break;
  }

  const plan = resolveTaskKickResume({
    previous,
    kick: {
      agentId: String(args.agentId),
      harness: args.harness,
      sessionId: args.sessionId,
      ...(liveSessionCreatedAt !== undefined ? { liveSessionCreatedAt } : {}),
    },
  });
  return {
    ...(plan.resume !== undefined ? { resume: plan.resume } : {}),
    ...(plan.sessionCreatedAt !== undefined
      ? { resumeSessionCreatedAt: plan.sessionCreatedAt }
      : {}),
    // The resumed conversation's memory ends at its predecessor's settle —
    // the delta bound for the discussion entries the resume prompt carries
    // (comments posted between runs would otherwise never be delivered).
    ...(plan.resume !== undefined && previous?.settledAt !== undefined
      ? { resumeDiscussionSince: previous.settledAt }
      : {}),
    sweep: plan.sweep,
    inspectNote: plan.inspectNote,
  };
}

/**
 * A freed session slot restarts the org's OLDEST capacity-parked run — the
 * release edge of every session-status transition out of {creating, active}
 * schedules this (see `scheduleSessionCapacityWake`). One wake claims one
 * run: one release freed one slot, and the restarted run's own settle (or
 * failure) fires the next edge, so the queue drains itself edge-by-edge; the
 * watchdog's periodic retry is the belt-and-braces for a lost edge.
 *
 * The agent's equipment (model, skills, connectors, instructions) is re-read
 * from the agent row at restart, exactly like a fresh kick — a run parked
 * across an equipment edit restarts with the CURRENT configuration. An agent
 * deleted while the run waited fails it with that reason.
 */
export const wakeParkedTaskAgentRuns = internalMutation({
  args: { organizationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    let oldest: Doc<'projectAgentRuns'> | null = null;
    let scanned = 0;
    for await (const run of ctx.db
      .query('projectAgentRuns')
      .withIndex('by_org_status', (q) =>
        q.eq('organizationId', args.organizationId).eq('status', 'queued'),
      )) {
      if (++scanned > STALLED_RUN_SCAN_LIMIT) break;
      if (run.waitingForCapacityAt === undefined) continue;
      if (oldest === null || run.startedAt < oldest.startedAt) oldest = run;
    }
    if (oldest === null) return null;
    const claimed = await ctx.runMutation(
      internal.tasks.agent_runs.claimParkedTaskAgentRun,
      { runId: oldest._id, execId: oldest.execId },
    );
    if (!claimed) return null;
    const agent = await ctx.db.get(oldest.agentId);
    if (!agent || agent.model === undefined) {
      await ctx.runMutation(internal.tasks.agent_runs.markTaskAgentRunFailed, {
        runId: oldest._id,
        error:
          agent === null
            ? 'the agent was deleted while the run waited for a sandbox slot'
            : 'the agent has no model configured',
      });
      return null;
    }
    // Re-run the kick-resume decision on the run's latest terminal
    // PREDECESSOR (this parked row is `queued`, so the walk skips it): the
    // kick's own decision predates the park and the world may have moved —
    // and dropping `resume` here would start fresh and could sweep
    // unpublished work the handle was protecting. The run's own minted
    // harness binds, not the agent's current one (the start execs the
    // former).
    const kickStart = await resolveTaskKickStartArgs(ctx, {
      taskId: oldest.taskId,
      agentId: oldest.agentId,
      harness: oldest.harness,
      sessionId: oldest.sessionId,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.tasks.agent_run_host.startTaskAgentTurn,
      {
        organizationId: oldest.organizationId,
        runId: oldest._id,
        taskId: oldest.taskId,
        agentId: oldest.agentId,
        execId: oldest.execId,
        sessionId: oldest.sessionId,
        harness: oldest.harness,
        deadlineAt: oldest.deadlineAt,
        ...kickStart,
        model: agent.model,
        ...(agent.modelProvider !== undefined
          ? { modelProvider: agent.modelProvider }
          : {}),
        ...(agent.instructions !== undefined
          ? { instructions: agent.instructions }
          : {}),
        skills: agent.skills,
        connectors: agent.connectors,
        tools: agent.tools ?? [],
        secrets: agent.secrets ?? [],
        ...(oldest.feedback !== undefined ? { feedback: oldest.feedback } : {}),
      },
    );
    return null;
  },
});

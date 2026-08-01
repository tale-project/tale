/**
 * The ask-a-human loop of an automation `agent` node.
 *
 * An agent turn that hits a decision only a person can make calls the
 * sandbox bridge's `ask_human` tool and ends its turn. The host then parks
 * the node on the ask instead of settling it (`agent_host`), the run stays
 * `waiting`, and the question surfaces on the task panel and the run views.
 * A member's answer resumes the SAME harness conversation on a fresh exec —
 * nothing upstream re-runs, no side effect repeats. Unanswered past
 * `expiresAt`, the host settles the turn as errored and the manifest decides
 * what "no answer" means.
 *
 * Tenant isolation: every row carries `organizationId`; the public surface
 * proves membership and reads through the run's own organization.
 */

import { ConvexError, v } from 'convex/values';

import { isRecord } from '../../lib/utils/type-utils';
import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { readCheckpoints } from './checkpoints';

/** How long a question waits for a person before the turn settles as
 * unanswered. A parked run is a database row — the wait costs nothing — but
 * an ask nobody will ever answer must not hold a task open forever. */
export const HUMAN_ASK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** One answer per turn: a second `ask_human` call while one is pending folds
 * into the same row, so the panel shows ONE card and one submission answers
 * everything the agent queued up. */
const QUESTION_JOINER = '\n\n';

/** Cap a stored question/answer — these render on cards and mirror into task
 * comments, not a log store. */
const TEXT_MAX = 8_000;

function cleanText(raw: string, label: string): string {
  const text = raw.trim();
  if (text === '') {
    throw new ConvexError({
      code: 'HUMAN_ASK_INVALID',
      message: `${label} must not be empty`,
    });
  }
  return text.length <= TEXT_MAX ? text : `${text.slice(0, TEXT_MAX)}…`;
}

/** The run's task subject, when the manifest gave it one (`input.task.id`) —
 * where the question/answer mirror lands. The run input is manifest-shaped
 * (`v.any()`), so the id normalizes instead of being trusted: garbage means
 * "no task", never a failed ask. */
function taskIdOfRun(
  db: QueryCtx['db'],
  run: Doc<'automationRuns'>,
): Id<'tasks'> | undefined {
  const input: unknown = run.input;
  if (!isRecord(input) || !isRecord(input.task)) return undefined;
  const raw = input.task.id;
  if (typeof raw !== 'string' || raw === '') return undefined;
  return db.normalizeId('tasks', raw) ?? undefined;
}

async function pendingAskForExec(
  ctx: { db: QueryCtx['db'] },
  sessionId: string,
  execId: string,
): Promise<Doc<'automationHumanAsks'> | null> {
  for await (const ask of ctx.db
    .query('automationHumanAsks')
    .withIndex('by_session_exec', (q) =>
      q.eq('sessionId', sessionId).eq('execId', execId),
    )) {
    if (ask.status === 'pending') return ask;
  }
  return null;
}

/**
 * Register one question from a live agent turn. The caller is the sandbox
 * bridge dispatch, which knows only the session token's (org, sessionId) —
 * the run, its LIVE exec, the node, and the task are all derived here from
 * the run's own cursor, so nothing client-supplied can attach a question to
 * a turn it does not own.
 */
export const createAskForExec = internalMutation({
  args: {
    organizationId: v.string(),
    sessionId: v.string(),
    question: v.string(),
  },
  returns: v.union(
    v.object({
      askId: v.id('automationHumanAsks'),
      taskId: v.optional(v.id('tasks')),
      question: v.string(),
      folded: v.boolean(),
    }),
    v.object({ refused: v.string() }),
  ),
  handler: async (ctx, args) => {
    const question = cleanText(args.question, 'question');
    const session = await ctx.db
      .query('sandboxSessions')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', args.sessionId))
      .first();
    if (
      session === null ||
      session.organizationId !== args.organizationId ||
      session.ownerType !== 'workflow_run'
    ) {
      return { refused: 'this session is not an automation run session' };
    }
    // `workflowExecutionOwnerId(runId)` = `${runId}:@workflow`.
    const runIdRaw = session.ownerId.split(':')[0] ?? '';
    const run = await ctx.db
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- derived from the session's owner key; a foreign id fails the org check below
      .get(runIdRaw as Id<'automationRuns'>)
      .catch(() => null);
    if (run === null || run.organizationId !== args.organizationId) {
      return { refused: 'the automation run behind this session is gone' };
    }
    if (
      run.status !== 'waiting' &&
      run.status !== 'running' &&
      run.status !== 'queued'
    ) {
      return { refused: 'the automation run has already finished' };
    }
    const cursor = readCheckpoints(run.checkpoints).cursor;
    if (cursor?.agent === undefined || cursor.agent.result !== undefined) {
      return { refused: 'the run has no live agent turn right now' };
    }
    const execId = cursor.agent.execId;

    const existing = await pendingAskForExec(ctx, args.sessionId, execId);
    if (existing !== null) {
      const merged = cleanText(
        `${existing.question}${QUESTION_JOINER}${question}`,
        'question',
      );
      await ctx.db.patch(existing._id, { question: merged });
      return {
        askId: existing._id,
        ...(existing.taskId !== undefined ? { taskId: existing.taskId } : {}),
        question,
        folded: true,
      };
    }

    const taskId = taskIdOfRun(ctx.db, run);
    const askId = await ctx.db.insert('automationHumanAsks', {
      organizationId: args.organizationId,
      runId: run._id,
      nodeId: cursor.node,
      sessionId: args.sessionId,
      execId,
      question,
      status: 'pending',
      expiresAt: Date.now() + HUMAN_ASK_TTL_MS,
      ...(taskId !== undefined ? { taskId } : {}),
      createdAt: Date.now(),
    });
    return {
      askId,
      ...(taskId !== undefined ? { taskId } : {}),
      question,
      folded: false,
    };
  },
});

/** Stamp the harness resume handle when the asking turn ends — what the
 * answered resume passes as `--resume` so the conversation continues. */
export const recordAskParked = internalMutation({
  args: {
    askId: v.id('automationHumanAsks'),
    agentSessionId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ask = await ctx.db.get(args.askId);
    if (ask === null || ask.status !== 'pending') return null;
    if (args.agentSessionId !== undefined) {
      await ctx.db.patch(args.askId, { agentSessionId: args.agentSessionId });
    }
    return null;
  },
});

/** The pending ask of one turn, read by the host's settle path to decide
 * park-for-answer over settle. */
export const getPendingAskForExec = internalQuery({
  args: { sessionId: v.string(), execId: v.string() },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) =>
    pendingAskForExec(ctx, args.sessionId, args.execId),
});

/** Full row for the resume action (already answered) — internal, org carried
 * for the same mixed-up-caller refusal the other internal reads use. */
export const getAskForResume = internalQuery({
  args: { askId: v.id('automationHumanAsks'), organizationId: v.string() },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    const ask = await ctx.db.get(args.askId);
    if (ask === null || ask.organizationId !== args.organizationId) return null;
    return ask;
  },
});

/** Terminal states the host stamps: `expired` when nobody answered in time,
 * `cancelled` when the turn ended in a crash or the run was cut. */
export const closeAsk = internalMutation({
  args: {
    askId: v.id('automationHumanAsks'),
    status: v.union(v.literal('expired'), v.literal('cancelled')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ask = await ctx.db.get(args.askId);
    if (ask === null || ask.status !== 'pending') return null;
    await ctx.db.patch(args.askId, { status: args.status });
    return null;
  },
});

/**
 * A member answers. Records the answer and hands the turn back to the agent
 * host, which resumes the SAME harness conversation with the answer as its
 * next message. The task-comment mirror of the answer is the CALLER's job
 * (the panel posts it as the member's own comment first, so the timeline
 * shows who answered) — this mutation owns only the resume contract.
 */
export const answerAsk = mutation({
  args: {
    organizationId: v.string(),
    askId: v.id('automationHumanAsks'),
    answer: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new ConvexError({ code: 'UNAUTHORIZED' });
    await getOrganizationMember(ctx, args.organizationId, authUser);
    const ask = await ctx.db.get(args.askId);
    if (ask === null || ask.organizationId !== args.organizationId) {
      throw new ConvexError({ code: 'HUMAN_ASK_NOT_FOUND' });
    }
    if (ask.status !== 'pending') {
      throw new ConvexError({ code: 'HUMAN_ASK_NOT_PENDING' });
    }
    if (Date.now() > ask.expiresAt) {
      throw new ConvexError({ code: 'HUMAN_ASK_EXPIRED' });
    }
    const answer = cleanText(args.answer, 'answer');
    await ctx.db.patch(args.askId, {
      status: 'answered',
      answer,
      answeredBy: authUser.userId,
      answeredAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      0,
      internal.automations.agent_host.resumeWorkflowAgentTurnWithAnswer,
      { organizationId: args.organizationId, askId: args.askId },
    );
    return null;
  },
});

const pendingAskShape = v.object({
  askId: v.id('automationHumanAsks'),
  runId: v.id('automationRuns'),
  nodeId: v.string(),
  question: v.string(),
  createdAt: v.number(),
  expiresAt: v.number(),
  taskId: v.optional(v.id('tasks')),
});

/** The live question of one run, for the run dialog and the task panel —
 * membership-gated like every public automation read. Null when nothing is
 * waiting on a person. */
export const getPendingAskForRun = query({
  args: { organizationId: v.string(), runId: v.id('automationRuns') },
  returns: v.union(pendingAskShape, v.null()),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;
    try {
      await getOrganizationMember(ctx, args.organizationId, authUser);
    } catch {
      // Non-member reads resolve to "nothing pending", mirroring the other
      // run-view queries: the panel degrades instead of erroring.
      console.warn('[human-asks] non-member pending-ask read refused');
      return null;
    }
    const run = await ctx.db.get(args.runId);
    if (run === null || run.organizationId !== args.organizationId) {
      return null;
    }
    // A dead run's question is unanswerable — the resume guard would refuse
    // anyway, so the card never offers it.
    if (
      run.status !== 'waiting' &&
      run.status !== 'running' &&
      run.status !== 'queued'
    ) {
      return null;
    }
    for await (const ask of ctx.db
      .query('automationHumanAsks')
      .withIndex('by_run_status', (q) =>
        q.eq('runId', args.runId).eq('status', 'pending'),
      )) {
      if (Date.now() > ask.expiresAt) continue; // expiry is stamped lazily
      return {
        askId: ask._id,
        runId: ask.runId,
        nodeId: ask.nodeId,
        question: ask.question,
        createdAt: ask.createdAt,
        expiresAt: ask.expiresAt,
        ...(ask.taskId !== undefined ? { taskId: ask.taskId } : {}),
      };
    }
    return null;
  },
});

/**
 * Move the run's parked agent cursor onto a new exec (the answered resume)
 * and/or a new deadline (the ask's own expiry while waiting). Guarded exactly
 * like `recordAgentTurnSettled`: the run must still be live, parked on this
 * node, on the expected exec, with no result — a stale resume retargets
 * nothing.
 */
export const retargetAgentCursor = internalMutation({
  args: {
    organizationId: v.string(),
    runId: v.id('automationRuns'),
    nodeId: v.string(),
    fromExecId: v.string(),
    toExecId: v.optional(v.string()),
    deadlineAt: v.optional(v.number()),
  },
  returns: v.object({ retargeted: v.boolean() }),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.runId);
    if (!row || row.organizationId !== args.organizationId) {
      return { retargeted: false };
    }
    if (
      row.status !== 'waiting' &&
      row.status !== 'running' &&
      row.status !== 'queued'
    ) {
      return { retargeted: false };
    }
    const checkpoints = readCheckpoints(row.checkpoints);
    const cursor = checkpoints.cursor;
    if (
      cursor === undefined ||
      cursor.node !== args.nodeId ||
      cursor.agent === undefined ||
      cursor.agent.execId !== args.fromExecId ||
      cursor.agent.result !== undefined
    ) {
      return { retargeted: false };
    }
    await ctx.db.patch(args.runId, {
      checkpoints: {
        nodes: checkpoints.nodes,
        cursor: {
          ...cursor,
          agent: {
            ...cursor.agent,
            ...(args.toExecId !== undefined ? { execId: args.toExecId } : {}),
            ...(args.deadlineAt !== undefined
              ? { deadlineAt: args.deadlineAt }
              : {}),
          },
        },
        executions: checkpoints.executions,
      },
    });
    return { retargeted: true };
  },
});

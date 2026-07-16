'use node';

/**
 * Same-(task, agent) mention serialization: when a mention run arrives while
 * that agent already has a RUNNING run on the same task, the platform must not
 * spawn a second parallel sandbox (two clones racing the same branch). The
 * preferred move is to STEER — stage the mentioning comment into the live
 * exec's steer dir (the same `tale-steer-hook` file contract chat uses; the
 * running Claude Code injects it at its next tool-use/stop boundary), so the
 * ORIGINAL sandbox keeps its workspace and simply continues with the new
 * instruction. When the live run isn't steerable, the caller falls back to
 * WAITING for it (see `runSandboxAgent`'s busy loop) — never to a parallel
 * run.
 *
 * At-most-once by design: a staged file the run never reaches (it finished a
 * moment later) is torn down with the session. That is safe — the comment
 * itself lives on the task, and the wait-then-fresh-run fallback (or the next
 * mention) picks it up. The chat path's delivered/consumed reconciliation is
 * deliberately NOT replicated here.
 */

import { getAgentCapabilities } from '../../../lib/agent-adapters/credential-policy';
import { resolveProductAgentKind } from '../../../lib/agent-adapters/events';
import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import type { ActionCtx } from '../../_generated/server';
import { sessionIdForWorkflowRun } from '../../sandbox/session_naming';
import { sessionStageFiles } from './helpers/session_client';
import { steerDirFor, steerFileName } from './steer_files';

export interface RunningPeerRun {
  runId: Id<'taskAgentRuns'>;
  wfExecutionId?: Id<'wfExecutions'>;
  stepSlug?: string;
  startedAt: number;
}

/** Look up the (task, agent) busy signal, excluding the caller's own step
 * identity (a retry's orphaned row must re-admit, not deadlock on itself). */
export async function findRunningPeerRun(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    taskId: Id<'tasks'>;
    agentSlug: string;
    ownWfExecutionId?: Id<'wfExecutions'> | undefined;
    ownStepSlug?: string | undefined;
  },
): Promise<RunningPeerRun | null> {
  return await ctx.runQuery(
    internal.task_metrics.internal_queries.getRunningRunForTaskAgent,
    {
      organizationId: args.organizationId,
      taskId: args.taskId,
      agentSlug: args.agentSlug,
      ...(args.ownWfExecutionId !== undefined && {
        excludeWfExecutionId: args.ownWfExecutionId,
      }),
      ...(args.ownStepSlug !== undefined && {
        excludeStepSlug: args.ownStepSlug,
      }),
    },
  );
}

export type SteerTaskRunResult =
  | { steered: true }
  | {
      steered: false;
      /** Why steering was impossible. `no_live_op` additionally means the peer
       * row is a zombie (no exec behind it) — callers should NOT wait on it. */
      reason:
        | 'no_workflow_identity'
        | 'no_live_op'
        | 'unsupported_runtime'
        | 'agent_idle'
        | 'stage_failed';
    };

/**
 * Stage `text` into the peer run's live exec. The message rides the chat steer
 * contract (`{messageId, text, createdAt}` JSON in
 * `.runtime/tale/steer/<execId>/steer-*.json`).
 */
export async function trySteerIntoRunningTaskRun(
  ctx: ActionCtx,
  args: {
    peer: RunningPeerRun;
    text: string;
  },
): Promise<SteerTaskRunResult> {
  const { peer } = args;
  // Inline runs (no workflow identity) have no sandbox session to steer.
  if (peer.wfExecutionId === undefined || peer.stepSlug === undefined) {
    return { steered: false, reason: 'no_workflow_identity' };
  }
  const sessionId = sessionIdForWorkflowRun(
    String(peer.wfExecutionId),
    peer.stepSlug,
  );
  const op = await ctx.runQuery(
    internal.sandbox.session_queries.getRunningAgentRunBySession,
    { sessionId },
  );
  if (op === null) return { steered: false, reason: 'no_live_op' };
  const kind = resolveProductAgentKind(op.agentKind);
  if (!getAgentCapabilities(kind).supportsMidTurnSteering) {
    return { steered: false, reason: 'unsupported_runtime' };
  }
  // A lingering-idle exec fires no tool/stop boundaries, so a staged file
  // would sit unconsumed (chat delivers via stdin there; task runs have no
  // stdin queue). Fall back to the wait path.
  if (op.agentIdleAt !== undefined) {
    return { steered: false, reason: 'agent_idle' };
  }
  const createdAt = Date.now();
  const messageId = `task-mention-${peer.runId}-${createdAt}`;
  const path = `${steerDirFor(op.execId)}/${steerFileName(createdAt, messageId)}`;
  try {
    const result = await sessionStageFiles(sessionId, [
      {
        path,
        contentBase64: Buffer.from(
          JSON.stringify({ messageId, text: args.text, createdAt }),
          'utf8',
        ).toString('base64'),
      },
    ]);
    if (!result.staged.some((s) => s.path === path)) {
      console.warn(
        '[steer_task_run] stage skipped:',
        result.skipped.map((s) => s.reason).join(', '),
      );
      return { steered: false, reason: 'stage_failed' };
    }
  } catch (err) {
    console.warn('[steer_task_run] stage failed:', err);
    return { steered: false, reason: 'stage_failed' };
  }
  return { steered: true };
}

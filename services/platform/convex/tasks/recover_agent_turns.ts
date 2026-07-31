'use node';

/**
 * RESTORATIVE watchdog for TASK agent runs whose draining action died — the
 * task-lane twin of `automations/recover_agent_turns.ts`, with the same
 * posture: the exec is the source of truth and this never kills a working
 * agent. Before it existed the lane had NO recovery at all: a lost
 * `driveTaskAgentTurn` reschedule stranded the run at `running` forever, its
 * op row silent and its gateway key unrevoked, because the 12h deadline is
 * only evaluated inside the very chain that died.
 *
 * For each abandoned run it probes the exec and re-attaches the drive chain;
 * a transport blip reads as "unknown" and the run is left for the next sweep
 * rather than failed. Re-attaching is safe by construction — the drive window
 * replays the exec's ring buffer, the settle is claimed exactly once
 * (`releaseTurnKey`), and `claimRecoveryResume` closes the query→schedule
 * race. A run whose op row was never written (a start that died first) is
 * claimed by creating the row — the run row is the durable proof the turn
 * exists.
 */

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalAction, type ActionCtx } from '../_generated/server';
import { isE2ECronSuppressed } from '../lib/e2e_cron_guard';
import { sessionExecStatus } from '../node_only/sandbox/helpers/session_client';

/** A live drainer bumps the op heartbeat once per window (~90s); silence past
 * this is "the chain is gone". Same knob as the automations watchdog. */
const STALE_MS = (() => {
  const configured = Number(process.env.TALE_AGENT_TURN_RECOVERY_STALE_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : 4 * 60 * 1000;
})();

/** Runs examined per sweep. */
const SWEEP_LIMIT = 25;

export const recoverStalledTaskAgentTurns = internalAction({
  args: {},
  returns: v.object({ resumed: v.number(), examined: v.number() }),
  handler: async (
    ctx: ActionCtx,
  ): Promise<{ resumed: number; examined: number }> => {
    if (isE2ECronSuppressed()) return { resumed: 0, examined: 0 };
    const staleBeforeMs = Date.now() - STALE_MS;
    const stalled = await ctx.runQuery(
      internal.tasks.agent_runs.listStalledTaskAgentTurns,
      { staleBeforeMs, limit: SWEEP_LIMIT },
    );
    let resumed = 0;
    for (const turn of stalled) {
      try {
        // Probe first — a transport hiccup must never be read as "dead
        // agent". The drive window handles running, terminal and vanished
        // execs alike; the probe only proves the sandbox is reachable.
        await sessionExecStatus(turn.sessionId, turn.execId);
      } catch (err) {
        console.warn(
          `[task-agent-watchdog] exec probe failed for ${turn.execId} (leaving for the next sweep):`,
          err,
        );
        continue;
      }
      const claimed = await ctx.runMutation(
        internal.sandbox.session_mutations.claimRecoveryResume,
        {
          sessionId: turn.sessionId,
          execId: turn.execId,
          staleBeforeMs,
          createMissing: {
            organizationId: turn.organizationId,
            kind: 'task-agent',
            deadlineMs: turn.deadlineAt,
          },
        },
      );
      if (!claimed) continue;
      await ctx.scheduler.runAfter(
        0,
        internal.tasks.agent_run_host.driveTaskAgentTurn,
        {
          organizationId: turn.organizationId,
          runId: turn.runId,
          taskId: turn.taskId,
          agentId: turn.agentId,
          execId: turn.execId,
          sessionId: turn.sessionId,
          harness: turn.harness,
          deadlineAt: turn.deadlineAt,
        },
      );
      resumed += 1;
      console.warn(
        `[task-agent-watchdog] re-attached abandoned turn ${turn.execId} of run ${String(turn.runId)} (task ${String(turn.taskId)})`,
      );
    }
    return { resumed, examined: stalled.length };
  },
});

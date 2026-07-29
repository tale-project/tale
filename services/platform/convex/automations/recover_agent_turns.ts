'use node';

/**
 * RESTORATIVE watchdog for automation `agent` turns whose draining action died.
 *
 * A parked agent turn is driven by a self-chaining action: each window
 * re-attaches to the sandbox exec, mirrors what the agent produced, and bumps
 * the op row's heartbeat. Nothing outside that chain re-enters the turn — the
 * run sits at `waiting`, which the durable-run sweep deliberately skips (a
 * healthy parked run must not be re-stepped). So when the chain dies — a deploy
 * mid-flight, an action kill, a crash — the turn is abandoned: the agent keeps
 * working (or finishes) inside the sandbox and the platform stops listening,
 * until the turn's wall-clock deadline finally fails a run whose work may have
 * completed long before.
 *
 * The posture is the chat lane's, which this mirrors deliberately: **the exec is
 * the source of truth and this never kills a working agent.** For each abandoned
 * turn it probes the exec and re-attaches the drive chain; a transport blip
 * reads as "unknown" and the turn is left for the next sweep rather than
 * failed. Re-attaching is safe by construction — the drive window replays the
 * exec's ring buffer from the start of the window, the settle is claimed exactly
 * once (`releaseTurnKey`), and `claimRecoveryResume` closes the
 * query→schedule race so two sweeps cannot both resurrect one turn.
 */

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalAction, type ActionCtx } from '../_generated/server';
import { isE2ECronSuppressed } from '../lib/e2e_cron_guard';
import { sessionExecStatus } from '../node_only/sandbox/helpers/session_client';

/**
 * A live drainer bumps the op heartbeat once per window (windows are ~90s), so
 * silence past this is "the chain is gone", with room for a handoff gap and a
 * cold start. Aggressive is safe: recovery only ever re-attaches.
 */
const STALE_MS = (() => {
  const configured = Number(process.env.TALE_AGENT_TURN_RECOVERY_STALE_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : 4 * 60 * 1000;
})();

/** Turns examined per sweep. */
const SWEEP_LIMIT = 25;

export const recoverStalledAgentTurns = internalAction({
  args: {},
  returns: v.object({ resumed: v.number(), examined: v.number() }),
  // The explicit return type breaks the inference cycle: this action is
  // referenced from the cron registry, so its own module's generated `internal`
  // type would otherwise depend on the handler that reads `internal`.
  handler: async (
    ctx: ActionCtx,
  ): Promise<{ resumed: number; examined: number }> => {
    if (isE2ECronSuppressed()) return { resumed: 0, examined: 0 };
    const staleBeforeMs = Date.now() - STALE_MS;
    const stalled = await ctx.runQuery(
      internal.automations.queries.listStalledAgentTurns,
      { staleBeforeMs, limit: SWEEP_LIMIT },
    );
    let resumed = 0;
    for (const turn of stalled) {
      // Past its own deadline: re-attaching would only race the drive action's
      // own deadline cut, which settles it with the real reason. Let that run.
      try {
        // Probe first — a transport hiccup must never be read as "dead agent".
        // The state itself does not change what we do (the drive window handles
        // a running exec, a terminal one and a vanished one alike); it is the
        // proof that the sandbox is reachable before we claim the turn.
        await sessionExecStatus(turn.sessionId, turn.execId);
      } catch (err) {
        console.warn(
          `[agent-turn-watchdog] exec probe failed for ${turn.execId} (leaving for the next sweep):`,
          err,
        );
        continue;
      }
      // Claim it: re-checks staleness under the mutation, so a chain that woke
      // up between the query and here keeps its turn.
      const claimed = await ctx.runMutation(
        internal.sandbox.session_mutations.claimRecoveryResume,
        {
          sessionId: turn.sessionId,
          execId: turn.execId,
          staleBeforeMs,
        },
      );
      if (!claimed) continue;
      await ctx.scheduler.runAfter(
        0,
        internal.automations.agent_host.driveWorkflowAgentTurn,
        {
          organizationId: turn.organizationId,
          runId: turn.runId,
          nodeId: turn.nodeId,
          execId: turn.execId,
          sessionId: turn.sessionId,
          harness: turn.harness,
          providerSlug: turn.providerSlug,
          gatewayModel: turn.gatewayModel,
          deadlineAt: turn.deadlineAt,
        },
      );
      resumed += 1;
      console.warn(
        `[agent-turn-watchdog] re-attached abandoned turn ${turn.execId} of run ${String(turn.runId)} (node ${turn.nodeId})`,
      );
    }
    return { resumed, examined: stalled.length };
  },
});

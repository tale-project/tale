'use node';

// RESTORATIVE recovery watchdog for external-agent turns whose draining action
// died (crash / hard action-ceiling kill) without finalizing.
//
// The platform is a pure I/O conduit; the sandbox exec is the source of truth.
// So this NEVER kills a working agent. For each abandoned op it probes the
// exec's liveness and either:
//   - RUNNING  → re-attach (schedule a continuation) so the platform resumes
//                mirroring the still-working agent. No VK revoke, no cancel, no
//                message-fail. (A superseded turn — its streamId no longer
//                current — is the one exception: the user started a newer turn,
//                so the stale exec is cancelled + finalized, not resurrected.)
//   - EXITED/GONE → the agent ended on its own; finalize ONCE using its real
//                outcome (success when it exited 0 / self-reported completed;
//                otherwise a failure carrying a real error).
//
// Wired into the existing sandbox watchdog cron (no new cron entry).

import { v } from 'convex/values';

import { internal } from '../../_generated/api';
import { internalAction, type ActionCtx } from '../../_generated/server';
import { isE2ECronSuppressed } from '../../lib/e2e_cron_guard';
import {
  type ExecLiveness,
  sessionCancelExec,
  sessionExecStatus,
} from '../../node_only/sandbox/helpers/session_client';
import {
  finalizeTurnSideEffects,
  markMessageStatus,
  type TurnContext,
} from './turn_lifecycle';

// A live action heartbeats every 20s. Treat ≥90s of silence as "the draining
// action is gone" — comfortably above the heartbeat cadence + a handoff/cold-
// start gap, so a healthy or handing-off turn is never probed as abandoned.
// Resume is non-destructive (it only ever re-attaches a still-live exec), so an
// aggressive threshold is safe; claimRecoveryResume re-checks staleness to close
// the query→claim race.
const RECOVERY_STALE_MS = Number(
  process.env.EXTERNAL_AGENT_RECOVERY_STALE_MS ?? String(90 * 1000),
);
const RECOVERY_SWEEP_LIMIT = 50;

export const recoverStuckExternalAgentTurns = internalAction({
  args: {},
  returns: v.object({ resumed: v.number(), finalized: v.number() }),
  handler: async (ctx: ActionCtx) => {
    if (isE2ECronSuppressed()) return { resumed: 0, finalized: 0 };
    const staleBeforeMs = Date.now() - RECOVERY_STALE_MS;
    const abandoned = await ctx.runQuery(
      internal.sandbox.session_queries.listAbandonedAgentOps,
      { staleBeforeMs, limit: RECOVERY_SWEEP_LIMIT },
    );
    let resumed = 0;
    let finalized = 0;
    for (const op of abandoned) {
      try {
        // 1. The exec is the source of truth — probe it. A transport blip
        //    (THROW) is "unknown": leave the op for the next sweep, NEVER
        //    finalize on a hiccup (that was the old bug that killed live agents).
        let liveness;
        try {
          liveness = await sessionExecStatus(op.sessionId, op.execId);
        } catch (probeErr) {
          console.warn(
            `[recoverStuckExternalAgentTurns] exec probe failed for ${op.execId} (leaving for next sweep):`,
            probeErr,
          );
          continue;
        }

        const turn: TurnContext = {
          organizationId: op.organizationId,
          sessionId: op.sessionId,
          execId: op.execId,
          threadId: op.threadId ?? '',
          agentKind: op.agentKind === 'opencode' ? 'opencode' : 'claude-code',
          modelRef: op.modelRef ?? '',
          assistantMessageId: op.assistantMessageId ?? '',
          mintedKeyId: op.mintedKeyId ?? null,
          continuationCount: op.continuationCount ?? 0,
          ...(op.agentSlug !== undefined && { agentSlug: op.agentSlug }),
          ...(op.userId !== undefined && { userId: op.userId }),
          ...(op.streamId !== undefined && { streamId: op.streamId }),
        };

        // 2. RUNNING → the agent is alive and working; the platform just lost
        //    its drainer. Resume — unless a newer user turn superseded it.
        if (liveness.state === 'running') {
          if (await isSuperseded(ctx, op.threadId, op.streamId)) {
            // The user moved on (a newer turn rotated the thread's streamId).
            // With one --resume conversation per thread the stale exec must
            // yield: cancel + finalize (the one sanctioned platform cancel,
            // mirroring a user Stop). Do NOT resurrect it.
            const won = await finalizeTurnSideEffects(ctx, turn);
            if (won) {
              if (op.assistantMessageId) {
                await markMessageStatus(
                  ctx,
                  op.assistantMessageId,
                  'success',
                ).catch((e) => console.warn('[recover] supersede mark:', e));
              }
              await ctx
                .runMutation(
                  internal.sandbox.session_mutations.upsertSessionOp,
                  {
                    organizationId: op.organizationId,
                    sessionId: op.sessionId,
                    execId: op.execId,
                    kind: 'agent-run',
                    status: 'cancelled',
                    heartbeatAt: Date.now(),
                  },
                )
                .catch((e) => console.warn('[recover] supersede op:', e));
              await sessionCancelExec(op.sessionId, op.execId).catch((e) =>
                console.warn('[recover] supersede cancel exec:', e),
              );
              finalized += 1;
            }
            continue;
          }
          // Can't resume without a message to stream into (degenerate — the op
          // always has one once the run started). Skip; next sweep re-evaluates.
          if (!op.assistantMessageId) continue;
          // Atomic single-claimant gate: re-checks staleness so a live action
          // that bumped its heartbeat between the query and now is not double-
          // attached. Loser/no-op → skip.
          const won = await ctx.runMutation(
            internal.sandbox.session_mutations.claimRecoveryResume,
            { sessionId: op.sessionId, execId: op.execId, staleBeforeMs },
          );
          if (!won) continue;
          await ctx.scheduler.runAfter(
            0,
            internal.agents.external_agent.continue_external_agent_turn
              .continueExternalAgentTurn,
            {
              organizationId: op.organizationId,
              sessionId: op.sessionId,
              execId: op.execId,
              threadId: op.threadId ?? '',
              agentKind:
                op.agentKind === 'opencode' ? 'opencode' : 'claude-code',
              modelRef: op.modelRef ?? '',
              assistantMessageId: op.assistantMessageId,
              mintedKeyId: op.mintedKeyId ?? null,
              continuationCount: op.continuationCount ?? 0,
              resumeSinceSeq: op.lastSeq ?? 0,
              ...(op.checkpointStorageId !== undefined && {
                checkpointStorageId: op.checkpointStorageId,
              }),
              ...(op.agentSessionId !== undefined && {
                agentSessionId: op.agentSessionId,
              }),
              ...(op.agentSlug !== undefined && { agentSlug: op.agentSlug }),
              ...(op.userId !== undefined && { userId: op.userId }),
              ...(op.streamId !== undefined && { streamId: op.streamId }),
            },
          );
          resumed += 1;
          continue;
        }

        // 3. EXITED / GONE → the agent ended without the action finalizing.
        //    Finalize ONCE with its real outcome. Nothing to cancel.
        const won = await finalizeTurnSideEffects(ctx, turn);
        if (!won) continue;
        const succeeded = reapedTurnSucceeded({
          agentResultStatus: op.agentResultStatus,
          liveness,
          progressText: op.progressText,
        });
        if (op.assistantMessageId) {
          if (succeeded) {
            await markMessageStatus(
              ctx,
              op.assistantMessageId,
              'success',
            ).catch((e) => console.warn('[recover] mark success:', e));
          } else {
            const errorText =
              liveness.state === 'exited'
                ? `The agent process exited unexpectedly (code ${liveness.exitCode ?? 'unknown'}).`
                : 'The agent process is no longer running and left no result to recover.';
            await markMessageStatus(
              ctx,
              op.assistantMessageId,
              'failed',
              errorText,
            ).catch((e) => console.warn('[recover] mark failed:', e));
          }
        }
        await ctx
          .runMutation(internal.sandbox.session_mutations.upsertSessionOp, {
            organizationId: op.organizationId,
            sessionId: op.sessionId,
            execId: op.execId,
            kind: 'agent-run',
            status: succeeded ? 'completed' : 'failed',
            heartbeatAt: Date.now(),
            ...(liveness.state === 'exited' && liveness.exitCode !== null
              ? { exitCode: liveness.exitCode }
              : {}),
          })
          .catch((e) => console.warn('[recover] op status:', e));
        finalized += 1;
      } catch (err) {
        console.warn(
          `[recoverStuckExternalAgentTurns] recovery failed for ${op.execId}:`,
          err,
        );
      }
    }
    if (resumed > 0 || finalized > 0) {
      console.warn(
        `[recoverStuckExternalAgentTurns] resumed ${resumed}, finalized ${finalized} abandoned turn(s)`,
      );
    }
    return { resumed, finalized };
  },
});

/**
 * Whether an EXITED/GONE turn the recovery watchdog reaped should finalize as
 * success (keep its streamed bubble) rather than failed ("Something went
 * wrong"). Order of authority:
 *   1. The agent self-reported `completed` → success.
 *   2. The process exited cleanly (code 0) → success.
 *   3. No self-reported result, but the agent already streamed a visible answer
 *      → success. This is the done-then-lingered case: a turn that held stdin
 *      open on a background task / poll and was cleaned up at the deadline. It
 *      mirrors the user-Stop ('cancelled') semantics (keep what streamed as a
 *      success bubble) instead of erroring a turn the user already answered.
 * A self-reported NON-completed result (a real agent error) is deliberately NOT
 * overridden by streamed output — the agent's own verdict wins.
 */
export function reapedTurnSucceeded(args: {
  agentResultStatus: string | undefined;
  liveness: ExecLiveness;
  progressText: string | undefined;
}): boolean {
  const hadRenderableOutput = (args.progressText?.trim().length ?? 0) > 0;
  return (
    args.agentResultStatus === 'completed' ||
    (args.liveness.state === 'exited' && args.liveness.exitCode === 0) ||
    (hadRenderableOutput && args.agentResultStatus === undefined)
  );
}

/** A turn is superseded when its thread's CURRENT generation streamId no longer
 * matches the op's streamId — a newer user turn took over. Best-effort: if we
 * can't read the thread meta, assume NOT superseded (resume is the safe default
 * for a live exec; a wrong resume self-corrects, a wrong cancel kills work). */
async function isSuperseded(
  ctx: ActionCtx,
  threadId: string | undefined,
  opStreamId: string | undefined,
): Promise<boolean> {
  if (threadId === undefined || opStreamId === undefined) return false;
  try {
    const meta = await ctx.runQuery(
      internal.threads.internal_queries.getThreadMetadata,
      { threadId },
    );
    return (
      meta !== null &&
      meta.streamId !== undefined &&
      meta.streamId !== opStreamId
    );
  } catch (err) {
    console.warn(
      '[recoverStuckExternalAgentTurns] supersede check failed:',
      err,
    );
    return false;
  }
}

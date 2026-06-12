'use node';

// Recovery watchdog for external-agent turns whose draining action died
// (crash / redeploy / 30min ceiling) without finalizing — the crash safety net
// the cross-action continuation can't cover. Finds `running` ops with a stale
// heartbeat and, exactly-once, finalizes them: revoke the VK, write the usage
// ledger, clear the thread's generation status, mark the message failed
// (preserving the timeline it already holds), and cancel the lingering exec.
//
// Wired into the existing sandbox watchdog cron (no new cron entry — matches
// the lazy/existing-pattern preference).

import { v } from 'convex/values';

import { internal } from '../../_generated/api';
import { internalAction, type ActionCtx } from '../../_generated/server';
import { sessionCancelExec } from '../../node_only/sandbox/helpers/session_client';
import {
  finalizeTurnSideEffects,
  markMessageStatus,
  type TurnContext,
} from './turn_lifecycle';

// A live action heartbeats every 20s; treat ≥3min of silence as dead. Well
// above any quiet-tool gap, well below the user noticing a wedged turn.
const RECOVERY_STALE_MS = Number(
  process.env.EXTERNAL_AGENT_RECOVERY_STALE_MS ?? String(3 * 60 * 1000),
);
const RECOVERY_SWEEP_LIMIT = 50;

export const recoverStuckExternalAgentTurns = internalAction({
  args: {},
  returns: v.object({ recovered: v.number() }),
  handler: async (ctx: ActionCtx) => {
    const abandoned = await ctx.runQuery(
      internal.sandbox.session_queries.listAbandonedAgentOps,
      {
        staleBeforeMs: Date.now() - RECOVERY_STALE_MS,
        limit: RECOVERY_SWEEP_LIMIT,
      },
    );
    let recovered = 0;
    for (const op of abandoned) {
      try {
        const turn: TurnContext = {
          organizationId: op.organizationId,
          sessionId: op.sessionId,
          execId: op.execId,
          threadId: op.threadId ?? '',
          // agentKind only feeds the usage agentSlug fallback; the real slug is
          // restored below when present.
          agentKind: 'claude-code',
          modelRef: op.modelRef ?? '',
          assistantMessageId: op.assistantMessageId ?? '',
          mintedKeyId: op.mintedKeyId ?? null,
          continuationCount: 0,
          ...(op.agentSlug !== undefined && { agentSlug: op.agentSlug }),
          ...(op.userId !== undefined && { userId: op.userId }),
          ...(op.streamId !== undefined && { streamId: op.streamId }),
        };
        // Exactly-once: only the claimer runs the side-effects. A live action
        // racing recovery (heartbeat just barely stale) loses the claim on one
        // side and no-ops.
        const won = await finalizeTurnSideEffects(ctx, turn);
        if (!won) continue;
        if (op.assistantMessageId) {
          await markMessageStatus(ctx, op.assistantMessageId, 'failed').catch(
            (e) => console.warn('[recoverStuckExternalAgentTurns] mark:', e),
          );
        }
        // Flip the op terminal too — finalizeTurnSideEffects only stamps
        // finalizedAt, so without this the row lingers as status='running'
        // (a zombie the management page would render as "busy").
        await ctx
          .runMutation(internal.sandbox.session_mutations.upsertSessionOp, {
            organizationId: op.organizationId,
            sessionId: op.sessionId,
            execId: op.execId,
            kind: 'agent-run',
            status: 'failed',
            heartbeatAt: Date.now(),
          })
          .catch((e) =>
            console.warn('[recoverStuckExternalAgentTurns] op status:', e),
          );
        // Kill the (possibly still-running) exec so it doesn't linger to the
        // runnerd timeout. Best-effort; the detach-grace likely already reaped
        // it once the action's connection dropped.
        await sessionCancelExec(op.sessionId, op.execId).catch((e) =>
          console.warn('[recoverStuckExternalAgentTurns] cancel exec:', e),
        );
        recovered += 1;
      } catch (err) {
        console.warn(
          `[recoverStuckExternalAgentTurns] recovery failed for ${op.execId}:`,
          err,
        );
      }
    }
    if (recovered > 0) {
      console.warn(
        `[recoverStuckExternalAgentTurns] recovered ${recovered} abandoned turn(s)`,
      );
    }
    return { recovered };
  },
});

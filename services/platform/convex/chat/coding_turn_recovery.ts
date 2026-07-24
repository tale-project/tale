'use node';

/**
 * Crash-recovery sweep for coding turns.
 *
 * A coding turn is driven by a self-chaining `driveCodingTurn` action. If a
 * reschedule is lost — a deploy or restart kills the in-flight action, or a
 * window throws past its handler — the turn's op + generation rows are left
 * `running` forever: the thread shows "generating" with no user escape. This
 * sweep is the backstop the op row's heartbeat exists for.
 *
 * It lists agent-run ops whose heartbeat went stale (no live drainer), probes
 * each exec, and either RESUMES it (the exec is still alive in the sandbox —
 * reschedule the drainer, which re-attaches) or FINALIZES it (the exec exited
 * or is gone — settle with the recorded outcome). Every terminal path revokes
 * the turn's gateway VK. The exactly-once claim (`claimRecoveryResume` /
 * `claimSessionOpFinalize`) keeps the sweep from double-driving a turn a live
 * drainer is still handling.
 */

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { sessionExecStatus } from '../node_only/sandbox/helpers/session_client';
import { revokeVirtualKey } from '../node_only/sandbox/llm_gateway_admin';
import {
  CODING_TURN_DEADLINE_MS,
  finalizeCodingTurn,
} from './coding_turn_shared';

/** No op heartbeat for this long ⇒ the drainer is dead. Comfortably past one
 * drain window (90s) + its reschedule, so a live-but-slow drainer is never
 * mistaken for a crashed one. */
const RECOVERY_STALE_MS = 5 * 60_000;
/** Ops finalized/resumed per sweep — bounds the action's work. */
const RECOVERY_BATCH = 20;

export const recoverAbandonedCodingTurns = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const staleBeforeMs = Date.now() - RECOVERY_STALE_MS;
    const abandoned = await ctx.runQuery(
      internal.sandbox.session_queries.listAbandonedAgentOps,
      { staleBeforeMs, limit: RECOVERY_BATCH },
    );

    for (const op of abandoned) {
      // Coding-chat turns carry a thread + user; the durable workflow lane is
      // session-scoped and sets neither. Only the coding lane is recovered here
      // (a workflow run resumes through its own durable handler).
      if (op.threadId === undefined || op.userId === undefined) continue;
      const scope = {
        organizationId: op.organizationId,
        threadId: op.threadId,
        userId: op.userId,
      };

      // Probe the exec WITHOUT consuming its stream: a transient spawner error
      // throws and leaves the op for the next sweep — never finalize on a blip.
      let liveness;
      try {
        liveness = await sessionExecStatus(op.sessionId, op.execId);
      } catch (err) {
        console.warn(
          `[coding-recovery] exec probe failed for ${op.execId}:`,
          err,
        );
        continue;
      }

      if (liveness.state === 'running') {
        // The exec is still working; only the drainer died. Claim the resume
        // (rejected if a live drainer bumped the heartbeat after the query) and
        // reschedule the drainer — it re-attaches from the ring buffer.
        const claimed = await ctx.runMutation(
          internal.sandbox.session_mutations.claimRecoveryResume,
          { sessionId: op.sessionId, execId: op.execId, staleBeforeMs },
        );
        if (!claimed) continue;
        await ctx.scheduler.runAfter(
          0,
          internal.chat.coding_turn_drive.driveCodingTurn,
          {
            organizationId: op.organizationId,
            threadId: op.threadId,
            userId: op.userId,
            deadlineAt: op.deadlineMs ?? Date.now() + CODING_TURN_DEADLINE_MS,
          },
        );
        continue;
      }

      // Exec exited or gone → settle the wedged turn. The generation row is
      // still present (finalize deletes it last), so it carries the model +
      // message the finalize needs.
      const state = await ctx.runQuery(
        internal.chat.generations.getCodingStateInternal,
        { organizationId: op.organizationId, threadId: op.threadId },
      );
      if (state !== null) {
        await finalizeCodingTurn(ctx, {
          scope,
          sessionId: op.sessionId,
          execId: op.execId,
          messageId: state.messageId,
          providerSlug: state.coding.providerSlug,
          gatewayModel: state.coding.gatewayModel,
          fallbackText: op.progressText ?? '',
          errored: true,
          harness: state.coding.harness,
          reason:
            liveness.state === 'gone'
              ? 'The sandbox session ended before the turn finished.'
              : 'The coding agent stopped unexpectedly.',
          ...(liveness.state === 'exited' && liveness.exitCode != null
            ? { exitCode: liveness.exitCode }
            : {}),
          ...(op.agentResultStatus !== undefined
            ? { agentResultStatus: op.agentResultStatus }
            : {}),
        });
        continue;
      }

      // Generation already gone but the op is still open — a finalize that
      // crashed before its terminal stamp. Close the op and revoke its VK
      // directly so nothing leaks.
      const won = await ctx.runMutation(
        internal.sandbox.session_mutations.claimSessionOpFinalize,
        { sessionId: op.sessionId, execId: op.execId },
      );
      if (!won) continue;
      if (op.mintedKeyId !== undefined) {
        await revokeVirtualKey(op.mintedKeyId).catch((err) =>
          console.warn(
            `[coding-recovery] revoke VK ${op.mintedKeyId} failed:`,
            err,
          ),
        );
        await ctx.runMutation(
          internal.sandbox.session_mutations.markSessionTokenRevokedByKeyId,
          { sessionId: op.sessionId, llmGatewayKeyId: op.mintedKeyId },
        );
      }
      await ctx.runMutation(
        internal.sandbox.session_mutations.upsertSessionOp,
        {
          organizationId: op.organizationId,
          sessionId: op.sessionId,
          threadId: op.threadId,
          execId: op.execId,
          kind: 'agent-run',
          status: 'failed',
        },
      );
    }
    return null;
  },
});

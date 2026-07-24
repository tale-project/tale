'use node';

// Tears down sandbox sessions out-of-band (HTTP calls a mutation can't make):
// destroys the spawner container/Pod + workspace and revokes the session's
// gateway tokens. Scheduled by the thread-delete cascade (the rows are already
// marked 'destroyed' there); idempotent so a retry or a spawner sweep that
// already reaped the container is harmless.

import { v } from 'convex/values';

import { internal } from '../../_generated/api';
import { internalAction } from '../../_generated/server';
import { sessionDestroy, sessionDestroyIfIdle } from './helpers/session_client';
import { revokeVirtualKey } from './llm_gateway_admin';

/**
 * End-of-turn teardown for the per-thread run_code session — the CONDITIONAL
 * flavour. Scheduled by `runGenerationCore`'s finally with the turn's own
 * threadId (a delegate sub-turn passes its sub-thread id, so every turn
 * cleans up exactly its own session). Destroys via `?if_idle=1`: when a
 * sibling turn on the same thread still has a live exec, the spawner no-ops
 * with busy=true and we leave EVERYTHING alone — the surviving turn's own
 * finally performs the teardown when it ends. Only after the spawner confirms
 * the destroy do we flip the platform rows (mark destroyed + capacity wake +
 * schedule the VK/op cleanup via destroyThreadOwnedSessions).
 */
export const teardownThreadSessionAtTurnEnd = internalAction({
  args: { threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.runQuery(
      internal.sandbox.session_queries.getActiveSessionByOwner,
      { ownerType: 'thread', ownerId: args.threadId },
    );
    if (row === null) return null;
    try {
      const res = await sessionDestroyIfIdle(row.sessionId);
      if (res.busy) {
        console.log(
          `[teardownThreadSessionAtTurnEnd] ${row.sessionId} busy (live exec) — leaving it to the surviving turn's teardown`,
        );
        return null;
      }
    } catch (err) {
      // Leave the row live: flipping it while the backend may survive would
      // 409 every future create against the deterministic sessionId. The next
      // turn's teardown (or the TTL reaper) retries.
      console.warn(
        `[teardownThreadSessionAtTurnEnd] conditional destroy ${row.sessionId} failed:`,
        err,
      );
      return null;
    }
    await ctx.runMutation(
      internal.sandbox.session_mutations.destroyThreadOwnedSessions,
      { threadId: args.threadId },
    );
    return null;
  },
});

/**
 * Reclaim the CREDENTIALS of hard-TTL-expired sessions (the row-flip half is
 * `recoverStuckSessions`, which schedules this). Revokes each session's gateway
 * VKs so an expired row can never leave a spendable credential live on the
 * gateway — the gap that let coding-turn keys accumulate past a session's life.
 *
 * Deliberately does NOT destroy the workspace: expiry is a lifetime cap, not an
 * explicit user Destroy, and "never destroy state without explicit permission"
 * is a hard boundary. The container is left to the spawner's idle reaper (which
 * stops, preserving the workspace); a later turn re-attaches the preserved dir
 * via the deterministic id, or starts fresh. Idempotent — an already-revoked
 * token is a no-op.
 */
export const teardownExpiredSessions = internalAction({
  args: { sessionIds: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const sessionId of args.sessionIds) {
      try {
        const { llmGatewayKeyIds } = await ctx.runMutation(
          internal.sandbox.session_mutations.revokeTokensForSession,
          { sessionId },
        );
        for (const keyId of llmGatewayKeyIds) {
          await revokeVirtualKey(keyId).catch((err) =>
            console.warn(
              `[teardownExpiredSessions] revoke VK ${keyId} failed:`,
              err,
            ),
          );
        }
      } catch (err) {
        console.warn(
          `[teardownExpiredSessions] revoke tokens ${sessionId} failed:`,
          err,
        );
      }
    }
    return null;
  },
});

export const teardownThreadSessions = internalAction({
  args: { sessionIds: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const sessionId of args.sessionIds) {
      try {
        await sessionDestroy(sessionId);
      } catch (err) {
        console.warn(
          `[teardownThreadSessions] sessionDestroy ${sessionId} failed:`,
          err,
        );
      }
      try {
        const { llmGatewayKeyIds } = await ctx.runMutation(
          internal.sandbox.session_mutations.revokeTokensForSession,
          { sessionId },
        );
        // Delete the live gateway VK(s), not just the bookkeeping mark — see
        // destroySandbox: teardown deletes the op rows the per-turn finalize +
        // recovery watchdog key on, so this is the only mid-turn revoke path.
        for (const keyId of llmGatewayKeyIds) {
          await revokeVirtualKey(keyId).catch((err) =>
            console.warn(
              `[teardownThreadSessions] revoke VK ${keyId} failed:`,
              err,
            ),
          );
        }
      } catch (err) {
        console.warn(
          `[teardownThreadSessions] revoke tokens ${sessionId} failed:`,
          err,
        );
      }
      try {
        await ctx.runMutation(
          internal.sandbox.session_mutations.deleteOpsForSession,
          { sessionId },
        );
      } catch (err) {
        console.warn(
          `[teardownThreadSessions] delete ops ${sessionId} failed:`,
          err,
        );
      }
    }
    return null;
  },
});

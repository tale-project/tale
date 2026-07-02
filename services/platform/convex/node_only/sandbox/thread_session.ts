'use node';

/**
 * Per-thread persistent sandbox session lifecycle for chat `run_code`
 * (Phase 2 of the persistent-session design — see
 * `services/sandbox/docs/run-code-persistent-sessions.md`).
 *
 * These are the reusable lifecycle actions. They reuse the exact session
 * machinery external agents run on (`session_mutations` / `session_client`),
 * keyed per-thread (`thr-<threadId>`, `ownerType: 'thread'`) so one thread's
 * packages/files never leak into another.
 *
 * We deliberately do NOT stop the session at turn end: the spawner's reaper
 * already stop-preserves an idle session (workspace kept) and a later
 * `sessionCreate` against the same deterministic id resumes it — so
 * "warm within a turn, preserved across turns" falls out of the existing
 * reaper + resume path with no turn-lifecycle surgery. The only explicit
 * teardown is {@link destroyThreadSession} on thread delete.
 *
 * Inert until the run_code dispatch stage calls these behind the
 * `SANDBOX_RUNCODE_SESSIONS` flag.
 */

import { v } from 'convex/values';

import { internal } from '../../_generated/api';
import { internalAction } from '../../_generated/server';
import { sessionIdForThread } from '../../sandbox/session_naming';
import {
  sessionCreate,
  sessionDestroy,
  sessionIsAlive,
} from './helpers/session_client';

const OWNER_TYPE = 'thread';
// run_code is untrusted user code — keep the hardened one-shot posture
// (uid 65534). (A long-lived `run_code` profile that also drops the
// cumulative-CPU ulimit is a follow-up on the sandbox side.)
const PROFILE = 'default' as const;

/**
 * Ensure the thread's session exists and is live; create or resume it.
 * Returns its deterministic `sessionId`. Idempotent within a turn: a warm
 * session is reused, a reaped one is recreated against the same id (its
 * preserved workspace re-attaches). TURN-scoped: `runGenerationCore`'s
 * finally destroys the session when the turn ends
 * (`teardownThreadSessionAtTurnEnd`, spared while a sibling turn's exec is
 * live) — it amortizes the run_code calls of one turn, never idles across
 * turns.
 */
export const ensureThreadSession = internalAction({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    createdBy: v.string(),
  },
  returns: v.object({ sessionId: v.string(), created: v.boolean() }),
  handler: async (ctx, args) => {
    const sessionId = sessionIdForThread(args.threadId);
    const existing = await ctx.runQuery(
      internal.sandbox.session_queries.getActiveSessionByOwner,
      { ownerType: OWNER_TYPE, ownerId: args.threadId },
    );

    if (existing !== null) {
      // Container actually up → reuse as-is.
      if (await sessionIsAlive(sessionId)) {
        return { sessionId, created: false };
      }
      // Row is live but the container was reaped/stopped — recreate against the
      // same id to re-attach the preserved workspace, then normalize the row.
      await sessionCreate({
        sessionId,
        organizationId: args.organizationId,
        profile: PROFILE,
      });
      await ctx.runMutation(
        internal.sandbox.session_mutations.resumeStoppedSession,
        { organizationId: args.organizationId, sessionId },
      );
      return { sessionId, created: false };
    }

    // No row yet — reserve a slot (per-owner + per-org caps enforced there) and
    // create fresh. A reserve conflict / capacity wait throws and surfaces to
    // the model as a run_code failure (there is no one-shot fallback path).
    const rowId = await ctx.runMutation(
      internal.sandbox.session_mutations.reserveSessionSlotAndInsert,
      {
        organizationId: args.organizationId,
        sessionId,
        profile: PROFILE,
        ownerType: OWNER_TYPE,
        ownerId: args.threadId,
        createdBy: args.createdBy,
      },
    );
    try {
      await sessionCreate({
        sessionId,
        organizationId: args.organizationId,
        profile: PROFILE,
      });
    } catch (err) {
      // Roll the reserved row out of the way so a retry isn't blocked by the
      // per-owner cap.
      await ctx.runMutation(
        internal.sandbox.session_mutations.setSessionStatus,
        { rowId, status: 'failed' },
      );
      throw err;
    }
    await ctx.runMutation(internal.sandbox.session_mutations.setSessionStatus, {
      rowId,
      status: 'active',
    });
    return { sessionId, created: true };
  },
});

/**
 * Tear down a thread's session for good (thread delete): destroy the container
 * + its preserved workspace, then mark the row destroyed. Best-effort and
 * idempotent — a already-gone session/row is a no-op.
 */
export const destroyThreadSession = internalAction({
  args: { organizationId: v.string(), threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sessionId = sessionIdForThread(args.threadId);
    try {
      await sessionDestroy(sessionId);
    } catch (err) {
      console.warn(`[thread_session] destroy(${sessionId}) failed:`, err);
    }
    const existing = await ctx.runQuery(
      internal.sandbox.session_queries.getActiveSessionByOwner,
      { ownerType: OWNER_TYPE, ownerId: args.threadId },
    );
    if (existing !== null) {
      await ctx.runMutation(
        internal.sandbox.session_mutations.setSessionStatus,
        { rowId: existing._id, status: 'destroyed' },
      );
    }
    return null;
  },
});

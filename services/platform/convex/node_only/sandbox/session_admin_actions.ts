'use node';

// Public control surface for the sandbox-management page (Stop / Destroy /
// Pin). Each is gated on the `developerSettings` capability via
// requireOrgAdminOrDeveloper and confirms the target session belongs to the
// caller's org before touching the spawner — defense in depth, since the
// spawner session id travels through the browser. The reads live in
// sandbox/session_queries_public.ts (listSandboxesForOrg).

import { ConvexError, v } from 'convex/values';

import { internal } from '../../_generated/api';
import { action, type ActionCtx } from '../../_generated/server';
import { requireOrgAdminOrDeveloper } from '../../lib/auth/require_org_admin_or_developer';
import {
  sessionCancelExec,
  sessionDestroy,
  sessionSetPinned,
} from './helpers/session_client';

/** Assert the session exists AND belongs to the caller's org before any spawner
 * call touches it (the spawner id travels through the browser). */
async function requireSessionInOrg(
  ctx: ActionCtx,
  organizationId: string,
  sessionId: string,
): Promise<void> {
  const row = await ctx.runQuery(
    internal.sandbox.session_queries.getSessionBySessionId,
    { sessionId },
  );
  if (!row || row.organizationId !== organizationId) {
    throw new ConvexError({
      code: 'SESSION_NOT_FOUND',
      message: 'Sandbox session not found in this organization.',
    });
  }
}

/**
 * Stop the session's running task: cancel every running exec. The draining
 * action gets a terminal 'cancelled' result and finalizes the message with its
 * tool timeline preserved (the same Stop semantics as the chat Stop button).
 */
export const stopSandboxTask = action({
  args: { organizationId: v.string(), sessionId: v.string() },
  returns: v.object({ cancelled: v.number() }),
  handler: async (ctx, args): Promise<{ cancelled: number }> => {
    await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    await requireSessionInOrg(ctx, args.organizationId, args.sessionId);

    const ops = await ctx.runQuery(
      internal.sandbox.session_queries.listRunningOpsBySession,
      { sessionId: args.sessionId },
    );
    let cancelled = 0;
    for (const op of ops) {
      try {
        await sessionCancelExec(op.sessionId, op.execId);
        cancelled += 1;
      } catch (err) {
        console.warn(
          `[stopSandboxTask] cancel ${op.sessionId}/${op.execId} failed:`,
          err,
        );
      }
    }
    return { cancelled };
  },
});

/**
 * Destroy the sandbox: mark the platform row destroyed, then tear down the
 * spawner container + revoke its tokens + prune its ops. The next chat turn
 * recreates a fresh sandbox on demand (so this doubles as "restart").
 */
export const destroySandbox = action({
  args: { organizationId: v.string(), sessionId: v.string() },
  returns: v.object({ destroyed: v.boolean() }),
  handler: async (ctx, args): Promise<{ destroyed: boolean }> => {
    await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    await requireSessionInOrg(ctx, args.organizationId, args.sessionId);

    const destroyed = await ctx.runMutation(
      internal.sandbox.session_mutations.markSessionRowDestroyed,
      { organizationId: args.organizationId, sessionId: args.sessionId },
    );
    // Out-of-band teardown (HTTP a mutation can't make). Best-effort — a
    // spawner sweep that already reaped the container is harmless, and the row
    // is already flipped so future turns recreate.
    try {
      await sessionDestroy(args.sessionId);
    } catch (err) {
      console.warn(`[destroySandbox] sessionDestroy ${args.sessionId}:`, err);
    }
    try {
      await ctx.runMutation(
        internal.sandbox.session_mutations.revokeTokensForSession,
        { sessionId: args.sessionId },
      );
    } catch (err) {
      console.warn(`[destroySandbox] revoke tokens ${args.sessionId}:`, err);
    }
    try {
      await ctx.runMutation(
        internal.sandbox.session_mutations.deleteOpsForSession,
        { sessionId: args.sessionId },
      );
    } catch (err) {
      console.warn(`[destroySandbox] delete ops ${args.sessionId}:`, err);
    }
    return { destroyed };
  },
});

/**
 * Pin / unpin a session: exempt it from the idle reaper + hard TTL (always-on),
 * or release it back to normal reaping. Patches the platform row (the truth a
 * spawner restart re-reads) and pushes the flag to the spawner registry.
 */
export const setSandboxPinned = action({
  args: {
    organizationId: v.string(),
    sessionId: v.string(),
    pinned: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    await requireSessionInOrg(ctx, args.organizationId, args.sessionId);

    await ctx.runMutation(internal.sandbox.session_mutations.setSessionPinned, {
      sessionId: args.sessionId,
      pinned: args.pinned,
    });
    try {
      await sessionSetPinned(args.sessionId, args.pinned);
    } catch (err) {
      // The platform row is the source of truth; the next turn re-pushes the
      // pin to the spawner if this transient push failed.
      console.warn(`[setSandboxPinned] spawner push ${args.sessionId}:`, err);
    }
    return null;
  },
});

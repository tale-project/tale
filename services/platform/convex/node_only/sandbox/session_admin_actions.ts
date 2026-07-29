'use node';

// Public control surface for the sandbox-management page (Stop / Destroy /
// Pin). Each is gated on the `developerSettings` capability via
// requireOrgAdminOrDeveloper and confirms the target session belongs to the
// caller's org before touching the spawner — defense in depth, since the
// spawner session id travels through the browser. The reads live in
// sandbox/session_queries_public.ts (listSandboxesForOrg).

import { ConvexError, v } from 'convex/values';

import { internal } from '../../_generated/api';
import {
  action,
  internalAction,
  type ActionCtx,
} from '../../_generated/server';
import { requireOrgAdminOrDeveloper } from '../../lib/auth/require_org_admin_or_developer';
import {
  sessionCancelExec,
  sessionCreate,
  sessionDestroy,
  sessionIsAlive,
  sessionSetPinned,
} from './helpers/session_client';
import { revokeVirtualKey } from './llm_gateway_admin';

/** Sessions reconciled per cron tick — bounds the action's spawner probes. */
const RECONCILE_BATCH = 100;

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

    // Backend teardown FIRST, and only flip the platform row once it
    // succeeded. The reverse order split-brains on a failed/raced teardown:
    // the row reads destroyed (the page shows nothing) while the spawner
    // still owns a live session, so the deterministic per-(org,user)
    // sessionId 409s on every future create. sessionDestroy throws on any
    // non-2xx — surfacing the failure to the page (the row stays live, the
    // user retries) instead of swallowing it.
    await sessionDestroy(args.sessionId);
    const destroyed = await ctx.runMutation(
      internal.sandbox.session_mutations.markSessionRowDestroyed,
      { organizationId: args.organizationId, sessionId: args.sessionId },
    );
    try {
      const { llmGatewayKeyIds } = await ctx.runMutation(
        internal.sandbox.session_mutations.revokeTokensForSession,
        { sessionId: args.sessionId },
      );
      // Delete the live gateway VK(s), not just the bookkeeping mark — a destroy
      // racing a live turn deletes the op row the per-turn finalize + recovery
      // watchdog key on, so this is the only path that revokes a mid-turn VK.
      for (const keyId of llmGatewayKeyIds) {
        await revokeVirtualKey(keyId).catch((err) =>
          console.warn(`[destroySandbox] revoke VK ${keyId}:`, err),
        );
      }
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
 * Reconcile the org's session rows with the spawner so the management page
 * shows "Stopped" honestly. The idle/TTL reaper releases a container
 * autonomously (spawner is pull-only — no callback), leaving the platform row
 * `active`; this probes each active/degraded row and flips the gone ones to
 * `stopped` (the workspace is preserved; the next turn resumes it). Triggered
 * opportunistically on page mount — no cron. Best-effort per session: a
 * transient spawner blip leaves that row for the next reconcile.
 */
export const reconcileOrgSessions = action({
  args: { organizationId: v.string() },
  returns: v.object({ stopped: v.number() }),
  handler: async (ctx, args): Promise<{ stopped: number }> => {
    await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    const candidates = await ctx.runQuery(
      internal.sandbox.session_queries.listReconcilableSessionsForOrg,
      { organizationId: args.organizationId },
    );
    let stopped = 0;
    for (const { sessionId } of candidates) {
      let alive: boolean;
      try {
        alive = await sessionIsAlive(sessionId);
      } catch (err) {
        console.warn(
          `[reconcileOrgSessions] liveness ${sessionId} failed:`,
          err,
        );
        continue;
      }
      if (alive) continue;
      try {
        const flipped = await ctx.runMutation(
          internal.sandbox.session_mutations.markSessionRowStopped,
          { organizationId: args.organizationId, sessionId },
        );
        if (flipped) stopped += 1;
      } catch (err) {
        console.warn(
          `[reconcileOrgSessions] mark stopped ${sessionId} failed:`,
          err,
        );
      }
    }
    return { stopped };
  },
});

/**
 * The drift-reconcile CRON — the main path (not the opportunistic page-mount
 * `reconcileOrgSessions`) that keeps the platform's session rows honest against
 * the pull-only spawner across ALL orgs:
 *
 *  - unpinned + gone → flip the row `stopped` (workspace preserved; next turn
 *    resumes it), so a page never shows a released container as "active".
 *  - pinned + alive → RE-ASSERT the pin: a spawner that restarted adopts the
 *    container but rebuilds its registry WITHOUT the pin flag, so the idle
 *    reaper would stop this always-on box ~30 min later. Re-pushing every cycle
 *    restores it well inside that window (the fix for pin-lost-on-restart).
 *  - pinned + gone → recreate against the preserved workspace so "always-on"
 *    holds and the row stops lying "active"; a recreate that keeps failing is
 *    logged (reaches GlitchTip) as unresolved drift rather than left silent.
 *
 * Best-effort per session: a transient spawner blip (`sessionIsAlive` throws on
 * any non-404) leaves that row for the next tick — never hibernated or
 * recreated on an ambiguous probe.
 */
export const reconcileSandboxSessions = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    const candidates = await ctx.runQuery(
      internal.sandbox.session_queries.listSessionsToReconcile,
      { limit: RECONCILE_BATCH },
    );
    for (const session of candidates) {
      let alive: boolean;
      try {
        alive = await sessionIsAlive(session.sessionId);
      } catch (err) {
        console.warn(
          `[reconcileSandboxSessions] liveness ${session.sessionId} failed:`,
          err,
        );
        continue;
      }

      if (session.pinned) {
        if (alive) {
          await sessionSetPinned(session.sessionId, true).catch((err) =>
            console.warn(
              `[reconcileSandboxSessions] re-push pin ${session.sessionId} failed:`,
              err,
            ),
          );
          continue;
        }
        try {
          await sessionCreate({
            sessionId: session.sessionId,
            organizationId: session.organizationId,
            profile: session.profile,
          });
          await ctx.runMutation(
            internal.sandbox.session_mutations.resumeStoppedSession,
            {
              organizationId: session.organizationId,
              sessionId: session.sessionId,
            },
          );
          await sessionSetPinned(session.sessionId, true).catch((err) =>
            console.warn(
              `[reconcileSandboxSessions] pin after recreate ${session.sessionId}:`,
              err,
            ),
          );
        } catch (err) {
          console.error(
            `[reconcileSandboxSessions] pinned session ${session.sessionId} is gone and could not be recreated (always-on degraded):`,
            err,
          );
        }
        continue;
      }

      if (alive) continue;
      try {
        await ctx.runMutation(
          internal.sandbox.session_mutations.markSessionRowStopped,
          {
            organizationId: session.organizationId,
            sessionId: session.sessionId,
          },
        );
      } catch (err) {
        console.warn(
          `[reconcileSandboxSessions] mark stopped ${session.sessionId} failed:`,
          err,
        );
      }
    }
    return null;
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
      organizationId: args.organizationId,
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

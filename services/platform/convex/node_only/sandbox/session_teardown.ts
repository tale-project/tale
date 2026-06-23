'use node';

// Tears down sandbox sessions out-of-band (HTTP calls a mutation can't make):
// destroys the spawner container/Pod + workspace and revokes the session's
// gateway tokens. Scheduled by the thread-delete cascade (the rows are already
// marked 'destroyed' there); idempotent so a retry or a spawner sweep that
// already reaped the container is harmless.

import { v } from 'convex/values';

import { internal } from '../../_generated/api';
import { internalAction } from '../../_generated/server';
import { sessionDestroy } from './helpers/session_client';
import { revokeVirtualKey } from './llm_gateway_admin';

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

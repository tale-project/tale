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
        await ctx.runMutation(
          internal.sandbox.session_mutations.revokeTokensForSession,
          { sessionId },
        );
      } catch (err) {
        console.warn(
          `[teardownThreadSessions] revoke tokens ${sessionId} failed:`,
          err,
        );
      }
    }
    return null;
  },
});

'use node';

// Session-cancel cascade for a thread. Every sandbox run is a session now, so
// Stop reaches the in-sandbox process by cancelling the thread's running
// `sandboxSessionOps` (and, on a browser-view deployment, resetting the stopped
// turn's tabs). The one-shot `executeCode` path this file used to host is gone —
// run_code, workflow steps, and crawler renders all run through sessions.

import { v } from 'convex/values';

import { internal } from '../../_generated/api';
import { internalAction, type ActionCtx } from '../../_generated/server';
import { browserViewEnabled } from './browser_view';
import {
  sessionBrowserClosePages,
  sessionCancelExec,
} from './helpers/session_client';

export const cancelSessionExecsForThread = internalAction({
  args: { threadId: v.string() },
  returns: v.number(),
  handler: async (ctx: ActionCtx, args) => {
    const ops = await ctx.runQuery(
      internal.sandbox.session_queries.listRunningOpsByThread,
      { threadId: args.threadId },
    );
    let cancelled = 0;
    const cancelledSessions = new Set<string>();
    for (const op of ops) {
      try {
        await sessionCancelExec(op.sessionId, op.execId);
        cancelled += 1;
        cancelledSessions.add(op.sessionId);
      } catch (err) {
        console.warn(
          `[sandbox.cancelSessionExecsForThread] sessionCancelExec(${op.sessionId}/${op.execId}) failed (continuing):`,
          err,
        );
      }
    }
    // On a browser-view deployment, reset the stopped turn's tabs so a
    // runaway/hung page can't wedge the next turn's CDP attach. Tabs only —
    // cookies/logins are preserved (close-pages, not reset). Best-effort: a
    // no-managed-browser session no-ops spawner-side, and any failure is logged
    // (the Stop itself already succeeded above).
    if (browserViewEnabled()) {
      for (const sessionId of cancelledSessions) {
        try {
          const closed = await sessionBrowserClosePages(sessionId);
          if (closed > 0) {
            console.info(
              `[sandbox.cancelSessionExecsForThread] closed ${closed} browser tab(s) for ${sessionId} on stop`,
            );
          }
        } catch (err) {
          console.warn(
            `[sandbox.cancelSessionExecsForThread] browser close-pages(${sessionId}) failed (continuing):`,
            err,
          );
        }
      }
    }
    return cancelled;
  },
});

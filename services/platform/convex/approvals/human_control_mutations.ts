import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';

/**
 * Authorize a `?control=1` screencast upgrade to the WRITABLE x11vnc. Called by
 * the screencast-auth oracle (http.ts), which has already confirmed the session
 * is `active` and run the org-scoped canAccessThread view boundary.
 *
 * Control is ALWAYS available to the thread OWNER while a session is active — the
 * human can grab the wheel at any time via the live browser pane. The owner
 * boundary is stricter than the view boundary on purpose: a writable browser is
 * more powerful than a mirror, so shared viewers stay read-only (a denied
 * control request still streams the read-only mirror).
 */
export const claimHumanControlLease = internalMutation({
  args: {
    threadId: v.string(),
    userId: v.string(),
  },
  returns: v.object({
    ok: v.boolean(),
    reason: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const meta = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();
    if (!meta) {
      return { ok: false, reason: 'no_thread' };
    }
    // Owner-only control: a shared viewer can watch, not drive.
    if (meta.userId !== args.userId) {
      return { ok: false, reason: 'forbidden' };
    }
    return { ok: true };
  },
});

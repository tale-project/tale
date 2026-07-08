/**
 * Internal functions backing the workspace-tool dispatch httpActions
 * (convex/agent_tools/dispatch_http.ts) — the first-party twin of
 * convex/integrations/dispatch_internal.ts.
 */

import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';

/** Append-only forensic audit row per workspace-tool dispatch call. */
export const recordToolCall = internalMutation({
  args: {
    organizationId: v.string(),
    sessionId: v.string(),
    tool: v.string(),
    userId: v.optional(v.string()),
    outcome: v.string(),
    paramsFingerprint: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert('sandboxToolCalls', {
      ...args,
      calledAt: Date.now(),
    });
    return null;
  },
});

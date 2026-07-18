'use node';

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';

/**
 * Liveness probe for the NODE-action lane.
 *
 * Self-hosted Convex runs `'use node'` actions in a separate node executor
 * whose syscalls (`ctx.runQuery` & co.) are HTTP callbacks to the backend.
 * That channel can wedge independently of everything the existing `/version`
 * probe sees — observed on demo v0.3.8 (2026-07-18): every node action failed
 * with "fetch failed" for hours while V8 queries and the HTTP-actions site
 * kept working and the status page said "operational".
 *
 * The platform's status prober invokes this through the admin-key
 * ConvexHttpClient channel (same as WebDAV), so no new public HTTP surface is
 * exposed. Executing this action at all proves the executor spawns; the inner
 * `runQuery` round-trip proves the callback channel — the part that actually
 * broke.
 */
export const ping = internalAction({
  args: {},
  returns: v.string(),
  handler: async (ctx): Promise<string> => {
    return await ctx.runQuery(internal.status.node_ping_queries.ok, {});
  },
});

// Public (browser-facing) read of a thread's live external-agent progress.
// The internal-only reads stay in session_queries.ts; this file holds the one
// query the chat UI subscribes to via useQuery, gated by the same thread RLS
// the message queries use.

import { v } from 'convex/values';

import { query } from '../_generated/server';
import { canAccessThread } from '../lib/rls/auth/can_access_thread';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';

/**
 * Latest in-session `agent-run` op for a thread, for live tool-use/text
 * rendering while an external-agent turn is in flight. Returns null when the
 * caller can't access the thread or no op exists yet — the UI then falls back
 * to its plain "Thinking…" placeholder. `recentEvents` are JSON-stringified
 * AgentEvents (the frontend maps them to thought-timeline steps).
 */
export const getActiveSessionOp = query({
  args: { threadId: v.string() },
  returns: v.union(
    v.object({
      status: v.union(
        v.literal('running'),
        v.literal('completed'),
        v.literal('failed'),
        v.literal('cancelled'),
      ),
      progressText: v.optional(v.string()),
      recentEvents: v.optional(v.array(v.string())),
      agentSessionId: v.optional(v.string()),
      startedAt: v.number(),
      finishedAt: v.optional(v.number()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;
    // Same allow-list the thread message queries enforce — don't let a bare
    // threadId leak another user's/org's session progress.
    const metadata = await canAccessThread(ctx, args.threadId, authUser);
    if (!metadata) return null;

    // Scope by thread, not session id — a per-user sandbox serves many threads
    // from one session, so the live op for THIS chat is found by threadId.
    let latest: {
      status: 'running' | 'completed' | 'failed' | 'cancelled';
      progressText?: string;
      recentEvents?: string[];
      agentSessionId?: string;
      startedAt: number;
      finishedAt?: number;
    } | null = null;
    for await (const row of ctx.db
      .query('sandboxSessionOps')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))) {
      if (row.kind !== 'agent-run') continue;
      if (latest === null || row.startedAt > latest.startedAt) {
        latest = {
          status: row.status,
          ...(row.progressText !== undefined && {
            progressText: row.progressText,
          }),
          ...(row.recentEvents !== undefined && {
            recentEvents: row.recentEvents,
          }),
          ...(row.agentSessionId !== undefined && {
            agentSessionId: row.agentSessionId,
          }),
          startedAt: row.startedAt,
          ...(row.finishedAt !== undefined && { finishedAt: row.finishedAt }),
        };
      }
    }
    return latest;
  },
});

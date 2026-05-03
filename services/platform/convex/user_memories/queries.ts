import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { query } from '../_generated/server';
import { assertSelfAndOrgMember } from '../lib/rls/auth/assert_self_and_org_member';
import { canAccessThread } from '../lib/rls/auth/can_access_thread';
import { requireAuthenticatedUser } from '../lib/rls/auth/require_authenticated_user';

/**
 * List the calling user's memories in (userId, organizationId) scope.
 *
 * Soft-deleted rows are always hidden. By default pending rows are also
 * hidden; flip `includePending` for the settings page's Pending section.
 */
export const listMyMemories = query({
  args: {
    organizationId: v.string(),
    includePending: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Doc<'userMemories'>[]> => {
    const authUser = await requireAuthenticatedUser(ctx);
    await assertSelfAndOrgMember(
      ctx,
      authUser,
      authUser.userId,
      args.organizationId,
    );

    const now = Date.now();
    const rows = await ctx.db
      .query('userMemories')
      .withIndex('by_user_org_status_deleted_created', (q) =>
        q
          .eq('userId', authUser.userId)
          .eq('organizationId', args.organizationId),
      )
      .order('desc')
      .collect();

    return rows.filter((m) => {
      if (typeof m.deletedAt === 'number') return false;
      if (m.status === 'pending') {
        if (!args.includePending) return false;
        return (
          typeof m.pendingExpiresAt !== 'number' || m.pendingExpiresAt >= now
        );
      }
      return true;
    });
  },
});

/**
 * List the user's *pending* memory proposals.
 *
 * - With `threadId`: scoped to that thread, used by the chat UI to render
 *   non-blocking inline confirmation cards. Caller must own the thread
 *   AND be a current member of the thread's org.
 * - With `organizationId` only: returns all pending proposals across
 *   threads in the org, used by the settings page aggregate view.
 *
 * Subscribes through Convex reactivity: when the user clicks Save /
 * Edit / Dismiss, the pending row mutates and this query auto-refreshes.
 */
export const listPendingMemories = query({
  args: {
    threadId: v.optional(v.string()),
    organizationId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Doc<'userMemories'>[]> => {
    const authUser = await requireAuthenticatedUser(ctx);

    let orgId: string | undefined;
    if (args.threadId) {
      const meta = await canAccessThread(ctx, args.threadId, authUser);
      if (!meta || meta.userId !== authUser.userId) return [];
      orgId = meta.organizationId ?? undefined;
    } else {
      orgId = args.organizationId;
    }
    if (!orgId) return [];
    await assertSelfAndOrgMember(ctx, authUser, authUser.userId, orgId);

    const now = Date.now();
    const rows = await ctx.db
      .query('userMemories')
      .withIndex('by_user_org_status_deleted_created', (q) =>
        q
          .eq('userId', authUser.userId)
          .eq('organizationId', orgId)
          .eq('status', 'pending'),
      )
      .collect();

    return rows.filter(
      (m) =>
        (!args.threadId || m.sourceThreadId === args.threadId) &&
        typeof m.deletedAt !== 'number' &&
        (typeof m.pendingExpiresAt !== 'number' || m.pendingExpiresAt >= now),
    );
  },
});

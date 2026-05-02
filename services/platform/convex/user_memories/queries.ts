import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { query } from '../_generated/server';
import { assertSelfAndOrgMember } from '../lib/rls/auth/assert_self_and_org_member';
import { canAccessThread } from '../lib/rls/auth/can_access_thread';
import { requireAuthenticatedUser } from '../lib/rls/auth/require_authenticated_user';

/**
 * List the calling user's memories in (userId, organizationId) scope.
 *
 * Defense-in-depth filtering: even when lazy cleanup hasn't fired yet,
 * stale pending rows and 30d+-soft-deleted rows are hidden. By default
 * pending rows are also hidden (they belong in `listPendingMemories` per
 * thread); flip `includePending` for the settings/Pending tab.
 */
export const listMyMemories = query({
  args: {
    organizationId: v.string(),
    includeInvalidated: v.optional(v.boolean()),
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
      // Soft-deleted rows are always hidden from list views — user can
      // restore via `restoreMemory` while still within the 30d window.
      if (typeof m.deletedAt === 'number') return false;
      if (m.status === 'pending') {
        if (!args.includePending) return false;
        return (
          typeof m.pendingExpiresAt !== 'number' || m.pendingExpiresAt >= now
        );
      }
      if (m.status === 'invalidated' && !args.includeInvalidated) return false;
      return true;
    });
  },
});

/**
 * List the user's *pending* memory proposals attached to a specific thread.
 * Used by the chat UI to render non-blocking inline confirmation cards
 * under the assistant message that triggered the propose_memory call.
 *
 * Subscribes through Convex reactivity: when the user clicks Save / Edit /
 * Dismiss, the pending row's status flips and this query auto-refreshes.
 */
export const listPendingMemories = query({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, args): Promise<Doc<'userMemories'>[]> => {
    const authUser = await requireAuthenticatedUser(ctx);
    // Must own the thread to see its pending memories.
    const meta = await canAccessThread(ctx, args.threadId, authUser);
    if (!meta || meta.userId !== authUser.userId) return [];
    const orgId = meta.organizationId;
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
        m.sourceThreadId === args.threadId &&
        typeof m.deletedAt !== 'number' &&
        (typeof m.pendingExpiresAt !== 'number' || m.pendingExpiresAt >= now),
    );
  },
});

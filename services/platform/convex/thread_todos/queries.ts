import { v } from 'convex/values';

import { query } from '../_generated/server';
import { isOrgMember } from '../lib/rls/auth/check_org_membership';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { todoItemValidator } from './schema';

/**
 * Get the current todos for a thread. Enforces org-membership auth and
 * thread-ownership/shared access. Returns null if caller cannot access.
 */
export const get = query({
  args: { threadId: v.string() },
  returns: v.union(
    v.object({
      threadId: v.string(),
      todos: v.array(todoItemValidator),
      activeTodoId: v.optional(v.string()),
      integrationCallCount: v.number(),
      updatedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;

    const threadMetadata = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();
    if (!threadMetadata) return null;

    const isOwner = threadMetadata.userId === authUser.userId;
    let hasAccess = isOwner;
    if (
      !hasAccess &&
      threadMetadata.isShared &&
      threadMetadata.organizationId
    ) {
      hasAccess = await isOrgMember(
        ctx,
        authUser.userId,
        threadMetadata.organizationId,
      );
    }
    const organizationId = threadMetadata.organizationId;
    if (!hasAccess || !organizationId) return null;

    const record = await ctx.db
      .query('threadTodos')
      .withIndex('by_org_thread', (q) =>
        q.eq('organizationId', organizationId).eq('threadId', args.threadId),
      )
      .first();
    if (!record) return null;

    return {
      threadId: record.threadId,
      todos: record.todos,
      activeTodoId: record.activeTodoId,
      integrationCallCount: record.integrationCallCount,
      updatedAt: record.updatedAt,
    };
  },
});

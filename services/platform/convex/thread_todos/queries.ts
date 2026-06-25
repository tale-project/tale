import { v } from 'convex/values';

import { query } from '../_generated/server';
import { isOrgMember } from '../lib/rls/auth/check_org_membership';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getBranchAncestorThreadIds } from '../threads/get_branch_ancestor_thread_ids';
import { getDelegateSubThreadIds } from '../threads/get_delegate_sub_thread_ids';
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

    const readTodos = (threadId: string) =>
      ctx.db
        .query('threadTodos')
        .withIndex('by_org_thread', (q) =>
          q.eq('organizationId', organizationId).eq('threadId', threadId),
        )
        .first();

    // Resolve the most-relevant single plan to show. Todos are one doc per
    // thread, so this is a fallback chain, NEVER a merge — two agents' (or two
    // branches') independent plans must not be spliced together.
    //
    // Order, matching the Canvas file lineage so files and the plan stay
    // consistent: walk the branch ancestor chain (active tip → … → root); at
    // each hop try its own todos, then its delegate sub-threads' (a Researcher
    // may write the plan on its OWN sub-thread). First hit wins, so the branch
    // the user is viewing — and its own delegate — beat an ancestor's plan.
    //
    // No fork-point cut here: a plan is a single living document with no
    // per-item fork linkage, so we surface the nearest one in the lineage
    // rather than trying to slice it. The `by_org_thread` org filter is the
    // access gate for sub-threads (which carry no `threadMetadata`).
    //
    // A "hit" requires a row with ACTUAL todos. A thread that only made
    // integration calls still owns a `threadTodos` row (it tracks
    // `integrationCallCount`) with an EMPTY `todos` array — that empty row must
    // NOT count as a plan, or it shadows a delegate sub-thread's real plan:
    // once the parent agent runs its own web/integration calls, an empty parent
    // row appears and the research-plan pane blinks out mid-run.
    const chain = await getBranchAncestorThreadIds(ctx, args.threadId);
    let record: Awaited<ReturnType<typeof readTodos>> = null;
    for (const hop of chain) {
      const own = await readTodos(hop.threadId);
      if (own && own.todos.length > 0) {
        record = own;
        break;
      }
      const subThreadIds = await getDelegateSubThreadIds(ctx, hop.threadId);
      for (const subThreadId of subThreadIds) {
        const sub = await readTodos(subThreadId);
        if (sub && sub.todos.length > 0) {
          record = sub;
          break;
        }
      }
      if (record) break;
    }
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

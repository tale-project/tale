import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';
import { getThreadMessages as getThreadMessagesHelper } from './get_thread_messages';
import { listThreads as listThreadsHelper } from './list_threads';

export const getThreadMetadata = internalQuery({
  args: {
    threadId: v.string(),
    /**
     * Caller's organizationId. When provided, the query refuses to
     * return a thread whose `organizationId` does not match — closing
     * the cross-org IDOR on REST `GET /api/v1/threads/:id`. Optional
     * for in-process callers that don't reach across orgs (legacy
     * thread-id-only callers); REST handlers MUST pass this.
     *
     * Returns `null` (not an error) on mismatch so the REST layer
     * surfaces a 404 instead of leaking thread existence.
     */
    callerOrgId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();
    if (!row) return null;
    if (
      args.callerOrgId !== undefined &&
      row.organizationId !== args.callerOrgId
    ) {
      return null;
    }
    return row;
  },
});

// ---------------------------------------------------------------------------
// REST API helpers
// ---------------------------------------------------------------------------

export const listThreadsInternal = internalQuery({
  args: {
    userId: v.string(),
    /**
     * Required for REST callers so cross-org threads (when the user
     * belongs to multiple orgs) are filtered out. Without it,
     * `listThreadsHelper` skips the `organizationId` predicate and
     * returns threads from every org the user is in — a multi-tenant
     * boundary leak. Optional for legacy in-process callers.
     */
    organizationId: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    return await listThreadsHelper(ctx, {
      userId: args.userId,
      organizationId: args.organizationId,
      paginationOpts: args.paginationOpts,
    });
  },
});

export const listArchivedThreadsInternal = internalQuery({
  args: {
    userId: v.string(),
    /** Same cross-org rationale as `listThreadsInternal`. */
    organizationId: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query('threadMetadata')
      .withIndex('by_userId_chatType_status_updated', (q) =>
        q
          .eq('userId', args.userId)
          .eq('chatType', 'general')
          .eq('status', 'archived'),
      )
      .order('desc')
      .paginate(args.paginationOpts);

    return {
      page: result.page
        .filter((row) => {
          if (row.isBranch) return false;
          if (
            args.organizationId !== undefined &&
            row.organizationId !== args.organizationId
          ) {
            return false;
          }
          return true;
        })
        .map((row) => ({
          _id: row.threadId,
          _creationTime: row.updatedAt ?? row.createdAt,
          title: row.title,
          status: row.status,
          userId: row.userId,
        })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const getThreadMessagesInternal = internalQuery({
  args: {
    threadId: v.string(),
    /**
     * Caller's organizationId. Same shape as `getThreadMetadata` —
     * REST handlers MUST pass this so cross-org reads return null
     * instead of leaking another tenant's messages.
     */
    callerOrgId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.callerOrgId !== undefined) {
      const meta = await ctx.db
        .query('threadMetadata')
        .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
        .first();
      if (!meta || meta.organizationId !== args.callerOrgId) {
        return { messages: [] };
      }
    }
    return await getThreadMessagesHelper(ctx, args.threadId);
  },
});

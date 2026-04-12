import { listMessages } from '@convex-dev/agent';
import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import { components } from '../_generated/api';
import { query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls';
import { isOrgMember } from '../lib/rls/auth/check_org_membership';
import { getThreadMessages as getThreadMessagesHelper } from './get_thread_messages';
import { getThreadMessagesStreaming as getThreadMessagesStreamingHelper } from './get_thread_messages_streaming';
import { listArchivedThreads as listArchivedThreadsHelper } from './list_archived_threads';
import { listThreads as listThreadsHelper } from './list_threads';

export const listThreads = query({
  args: {
    paginationOpts: v.optional(paginationOptsValidator),
    teamId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return {
        page: [],
        isDone: true,
        continueCursor: '',
      };
    }

    return await listThreadsHelper(ctx, {
      userId: authUser.userId,
      paginationOpts: args.paginationOpts ?? { cursor: null, numItems: 20 },
      teamId: args.teamId,
    });
  },
});

export const listArchivedThreads = query({
  args: {
    paginationOpts: v.optional(paginationOptsValidator),
    teamId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return {
        page: [],
        isDone: true,
        continueCursor: '',
      };
    }

    return await listArchivedThreadsHelper(ctx, {
      userId: authUser.userId,
      paginationOpts: args.paginationOpts ?? { cursor: null, numItems: 20 },
      teamId: args.teamId,
    });
  },
});

/**
 * Maximum time (ms) a generation is considered active before it's treated as
 * stale. If the server-side action crashed without resetting generationStatus,
 * this prevents the client from being permanently blocked.
 */
const GENERATION_STALE_THRESHOLD_MS = 10 * 60 * 1000;

export const isThreadGenerating = query({
  args: { threadId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return false;

    const metadata = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();

    if (!metadata || metadata.userId !== authUser.userId) return false;
    if (metadata.generationStatus !== 'generating') return false;

    // Guard against stuck generationStatus: if the action crashed without
    // cleanup, the generation start time lets us detect staleness and
    // unblock the client instead of requiring a page refresh.
    if (metadata.generationStartTime) {
      const elapsed = Date.now() - metadata.generationStartTime;
      if (elapsed > GENERATION_STALE_THRESHOLD_MS) return false;
    }

    return true;
  },
});

export const getThreadMessages = query({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return { messages: [] };
    }
    return await getThreadMessagesHelper(ctx, args.threadId);
  },
});

export const getThreadMessagesStreaming = query({
  args: {
    threadId: v.string(),
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
      endCursor: v.optional(v.union(v.string(), v.null())),
      id: v.optional(v.number()),
      maximumRowsRead: v.optional(v.number()),
      maximumBytesRead: v.optional(v.number()),
    }),
    streamArgs: v.optional(
      v.union(
        v.object({
          kind: v.literal('list'),
          startOrder: v.optional(v.number()),
        }),
        v.object({
          kind: v.literal('deltas'),
          cursors: v.array(
            v.object({
              streamId: v.string(),
              cursor: v.number(),
            }),
          ),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return {
        page: [],
        isDone: true,
        continueCursor: '',
        streams: { value: null },
      };
    }

    const metadata = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();

    const isOwner = metadata?.userId === authUser.userId;

    // Non-owner: check if thread is shared and user is in the same org
    let isSharedAccess = false;
    if (metadata && !isOwner && metadata.isShared && metadata.organizationId) {
      isSharedAccess = await isOrgMember(
        ctx,
        authUser.userId,
        metadata.organizationId,
      );
    }

    if (!metadata || (!isOwner && !isSharedAccess)) {
      return {
        page: [],
        isDone: true,
        continueCursor: '',
        streams: { value: null },
      };
    }

    return await getThreadMessagesStreamingHelper(ctx, {
      threadId: args.threadId,
      paginationOpts: args.paginationOpts,
      streamArgs: args.streamArgs,
    });
  },
});

/**
 * Returns error strings for failed messages in a thread.
 * Separate from the streaming query to avoid creating new object references
 * on UIMessages (which breaks React/SDK dedup during streaming transitions).
 */
export const getFailedMessageErrors = query({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return {};

    const metadata = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();

    if (!metadata || metadata.userId !== authUser.userId) return {};

    const result = await listMessages(ctx, components.agent, {
      threadId: args.threadId,
      paginationOpts: { cursor: null, numItems: 10 },
      statuses: ['failed'],
    });
    const errors: Record<string, string> = {};
    for (const msg of result.page) {
      if (msg.error) errors[msg._id] = msg.error;
    }
    return errors;
  },
});

export const getThreadStatus = query({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return null;
    }

    const metadata = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();

    if (!metadata) return null;

    // Owner always gets the real status
    if (metadata.userId === authUser.userId) {
      return metadata.status ?? null;
    }

    // Non-owner: allow read-only access if thread is shared and user is in the same org
    if (metadata.isShared && metadata.organizationId) {
      const isMember = await isOrgMember(
        ctx,
        authUser.userId,
        metadata.organizationId,
      );
      if (isMember) {
        return 'shared-readonly';
      }
    }

    return null;
  },
});

export { getSharedThread } from './get_shared_thread';

export const getThreadBranches = query({
  args: { rootThreadId: v.string() },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return [];

    const rootMetadata = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.rootThreadId))
      .first();

    if (!rootMetadata || rootMetadata.userId !== authUser.userId) return [];

    const branches: Array<{
      branchThreadId: string;
      parentThreadId: string;
      forkAfterMessageId: string;
      forkOrder: number;
      branchIndex: number;
      createdAt: number;
    }> = [];

    const branchQuery = ctx.db
      .query('threadBranches')
      .withIndex('by_rootThreadId', (q) =>
        q.eq('rootThreadId', args.rootThreadId),
      );

    for await (const branch of branchQuery) {
      branches.push({
        branchThreadId: branch.branchThreadId,
        parentThreadId: branch.parentThreadId,
        forkAfterMessageId: branch.forkAfterMessageId,
        forkOrder: branch.forkOrder,
        branchIndex: branch.branchIndex,
        createdAt: branch.createdAt,
      });
    }

    return branches;
  },
});

export const getThreadBranchSelections = query({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;

    const metadata = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();

    if (!metadata || metadata.userId !== authUser.userId) return null;

    return metadata.branchSelections ?? null;
  },
});

export const getThreadShareStatus = query({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return { isShared: false, shareToken: null };
    }

    const metadata = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();

    if (!metadata || metadata.userId !== authUser.userId) {
      return { isShared: false, shareToken: null };
    }

    return {
      isShared: metadata.isShared ?? false,
      shareToken: metadata.shareToken ?? null,
      sharedAt: metadata.sharedAt ?? null,
    };
  },
});

export const getArenaThreadPair = query({
  args: { threadId: v.string() },
  returns: v.union(
    v.object({
      threadIdA: v.string(),
      threadIdB: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;

    const metadata = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();

    if (!metadata?.arenaGroupId || metadata.userId !== authUser.userId) {
      return null;
    }

    // Find all threads in this arena group
    const groupThreads: Array<{ threadId: string; isBranch: boolean }> = [];
    for await (const t of ctx.db
      .query('threadMetadata')
      .withIndex('by_arenaGroupId', (q) =>
        q.eq('arenaGroupId', metadata.arenaGroupId),
      )) {
      groupThreads.push({
        threadId: t.threadId,
        isBranch: t.isBranch ?? false,
      });
    }

    if (groupThreads.length < 2) return null;

    // Thread A = root (not branch), Thread B = branch
    const threadA = groupThreads.find((t) => !t.isBranch);
    const threadB = groupThreads.find((t) => t.isBranch);

    if (!threadA || !threadB) return null;

    return { threadIdA: threadA.threadId, threadIdB: threadB.threadId };
  },
});

export const getThreadForkInfo = query({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return null;
    }

    const metadata = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();

    if (
      !metadata ||
      metadata.userId !== authUser.userId ||
      !metadata.forkedFrom
    ) {
      return null;
    }

    return {
      forkedFrom: metadata.forkedFrom,
      forkedFromShare: metadata.forkedFromShare ?? false,
      forkedMessageCount: metadata.forkedMessageCount ?? null,
      lastForkedMessageOrder: metadata.lastForkedMessageOrder ?? null,
    };
  },
});

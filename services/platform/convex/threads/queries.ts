import { listMessages } from '@convex-dev/agent';
import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import { components } from '../_generated/api';
import { query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls';
import { canAccessThread } from '../lib/rls/auth/can_access_thread';
import { autoRouteReasonValidator } from '../streaming/validators';
import { getThreadMessages as getThreadMessagesHelper } from './get_thread_messages';
import { getThreadMessagesStreaming as getThreadMessagesStreamingHelper } from './get_thread_messages_streaming';
import { listArchivedThreads as listArchivedThreadsHelper } from './list_archived_threads';
import { listThreads as listThreadsHelper } from './list_threads';

export const listThreads = query({
  args: {
    paginationOpts: v.optional(paginationOptsValidator),
    teamId: v.optional(v.string()),
    organizationId: v.optional(v.string()),
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
      organizationId: args.organizationId,
    });
  },
});

export const listArchivedThreads = query({
  args: {
    paginationOpts: v.optional(paginationOptsValidator),
    teamId: v.optional(v.string()),
    organizationId: v.optional(v.string()),
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
      organizationId: args.organizationId,
    });
  },
});

/**
 * Maximum time (ms) a generation is considered active before it's treated as
 * stale. If the server-side action crashed without resetting generationStatus,
 * this prevents the client from being permanently blocked.
 *
 * Sized to cover the longest legitimate run: self-hosted Convex actions have a
 * 30-minute Docker ceiling, and the researcher agent runs up to ~25 min. A
 * 5-minute buffer above the hard ceiling avoids killing the UI on slow tails.
 *
 * Staleness is judged against the latest sign of life — `generationStartTime`
 * OR `generationHeartbeatAt` (bumped ~20s by the sandbox runner) — so
 * external-agent turns that legitimately outlive this window via cross-action
 * continuation stay "generating" as long as they keep heartbeating.
 */
const GENERATION_STALE_THRESHOLD_MS = 30 * 60 * 1000 + 5 * 60 * 1000;

/**
 * Shared stale-guard: a 'generating' thread counts as live when it has no
 * liveness timestamps at all (legacy rows — preserve the historical "no
 * startTime → not stale" semantics) or its most recent sign of life is within
 * the threshold.
 */
function isGenerationFresh(metadata: {
  generationStartTime?: number;
  generationHeartbeatAt?: number;
}): boolean {
  const lastAliveAt = Math.max(
    metadata.generationStartTime ?? 0,
    metadata.generationHeartbeatAt ?? 0,
  );
  if (lastAliveAt === 0) return true;
  return Date.now() - lastAliveAt <= GENERATION_STALE_THRESHOLD_MS;
}

export const isThreadGenerating = query({
  args: { threadId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return false;

    // canAccessThread rejects trashed/expired/deleted threads as well as
    // non-owners — without it, an owner querying their own trashed thread
    // still saw `generating` until Pass-B physically deleted the row
    // (round-2 v15 H8).
    const metadata = await canAccessThread(ctx, args.threadId, authUser);
    if (!metadata) return false;
    if (metadata.generationStatus !== 'generating') return false;

    // Guard against stuck generationStatus: if the action crashed without
    // cleanup, the liveness timestamps let us detect staleness and unblock
    // the client instead of requiring a page refresh.
    return isGenerationFresh(metadata);
  },
});

export const getThreadMessages = query({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return { messages: [] };
    }
    // Mirror the streaming sibling at `getThreadMessagesStreaming`. Without
    // this gate, any signed-in user with a threadId could read every
    // message — bypasses owner / org / isShared / trashed checks and
    // relies on UUID secrecy for authorization. canAccessThread enforces
    // the same allow-list the streaming path already uses.
    const metadata = await canAccessThread(ctx, args.threadId, authUser);
    if (!metadata) {
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

    const metadata = await canAccessThread(ctx, args.threadId, authUser);
    if (!metadata) {
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

    // canAccessThread blocks trashed/expired/deleted threads — error
    // strings can leak PII the user thought they trashed.
    const metadata = await canAccessThread(ctx, args.threadId, authUser);
    if (!metadata) return {};

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
  args: {
    threadId: v.string(),
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return null;
    }

    const metadata = await canAccessThread(
      ctx,
      args.threadId,
      authUser,
      args.organizationId,
    );
    if (!metadata) return null;

    // Owner always gets the real status; non-owners reach this path only when
    // the thread is shared, so they get a read-only marker.
    if (metadata.userId === authUser.userId) {
      return metadata.status ?? null;
    }
    return 'shared-readonly';
  },
});

/**
 * The project a thread belongs to (if any), gated on thread access. Lets the
 * chat composer apply the project's model/agent restrictions + recommendations
 * for existing project chats (where the projectId isn't in the URL).
 */
export const getThreadProject = query({
  args: {
    threadId: v.string(),
    organizationId: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({ projectId: v.union(v.id('projects'), v.null()) }),
  ),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;
    const metadata = await canAccessThread(
      ctx,
      args.threadId,
      authUser,
      args.organizationId,
    );
    if (!metadata) return null;
    return { projectId: metadata.projectId ?? null };
  },
});

/**
 * Consolidated per-thread metadata for the chat surface: project, fork info,
 * live generation status, and failed-message error strings — all behind a
 * SINGLE canAccessThread check. ChatInterface + useMessageProcessing read this
 * one query instead of four separate subscriptions (getThreadProject,
 * getThreadForkInfo, isThreadGenerating, getFailedMessageErrors), each of which
 * independently re-ran the access check on every thread switch. Returns null
 * when the thread is inaccessible. (Arena split view and the automations chat
 * still use the granular queries directly.)
 */
export const getThreadMeta = query({
  args: { threadId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      projectId: v.union(v.id('projects'), v.null()),
      isGenerating: v.boolean(),
      forkInfo: v.union(
        v.null(),
        v.object({
          forkedFrom: v.string(),
          forkedFromShare: v.boolean(),
          forkedMessageCount: v.union(v.number(), v.null()),
          lastForkedMessageOrder: v.union(v.number(), v.null()),
          forkedAt: v.union(v.number(), v.null()),
        }),
      ),
      failedErrors: v.record(v.string(), v.string()),
      // Per-thread canvas (workspace pane) state — the WorkspaceProvider
      // reads this on mount so reopening a thread restores its layout.
      // `null` activeFilePath means "use the first listed file".
      canvasState: v.object({
        isOpen: v.boolean(),
        activeFilePath: v.union(v.string(), v.null()),
      }),
      // The in-flight turn's resolved Auto route, for the live "Routed to X"
      // thinking-timeline step. Null unless this thread is actively generating
      // (the stale guard below also fences it), so a stale field never renders
      // on an idle thread.
      liveRoute: v.union(
        v.null(),
        v.object({ agentSlug: v.string(), reason: autoRouteReasonValidator }),
      ),
      // Turn start (markGenerating, BEFORE Auto routing) — the authoritative
      // anchor for the live "Thinking · Ns" timer, so it's identical across the
      // gap-shell→bubble handoff AND the new-chat remount (no reset). Only while
      // generating (mirrors liveRoute), so an idle thread never carries a stale
      // start; `null` otherwise.
      generationStartTime: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;

    const metadata = await canAccessThread(ctx, args.threadId, authUser);
    if (!metadata) return null;

    // Live generation status (mirrors isThreadGenerating, incl. stale guard).
    const isGenerating =
      metadata.generationStatus === 'generating' && isGenerationFresh(metadata);

    // Fork info — owner-only, forked threads only (mirrors getThreadForkInfo).
    const forkInfo =
      metadata.userId === authUser.userId && metadata.forkedFrom
        ? {
            forkedFrom: metadata.forkedFrom,
            forkedFromShare: metadata.forkedFromShare ?? false,
            forkedMessageCount: metadata.forkedMessageCount ?? null,
            lastForkedMessageOrder: metadata.lastForkedMessageOrder ?? null,
            forkedAt: metadata.forkedAt ?? null,
          }
        : null;

    // Failed-message error strings (mirrors getFailedMessageErrors).
    const failedResult = await listMessages(ctx, components.agent, {
      threadId: args.threadId,
      paginationOpts: { cursor: null, numItems: 10 },
      statuses: ['failed'],
    });
    const failedErrors: Record<string, string> = {};
    for (const msg of failedResult.page) {
      if (msg.error) failedErrors[msg._id] = msg.error;
    }

    return {
      projectId: metadata.projectId ?? null,
      isGenerating,
      forkInfo,
      failedErrors,
      canvasState: {
        isOpen: metadata.canvasOpen ?? false,
        activeFilePath: metadata.canvasActiveFilePath ?? null,
      },
      // Only while actively generating — `isGenerating` already carries the
      // stale-generation guard, so a leftover liveRoute can't surface on an idle
      // thread.
      liveRoute:
        isGenerating && metadata.liveRoute
          ? {
              agentSlug: metadata.liveRoute.agentSlug,
              reason: metadata.liveRoute.reason,
            }
          : null,
      generationStartTime:
        isGenerating && metadata.generationStartTime
          ? metadata.generationStartTime
          : null,
    };
  },
});

/**
 * Count the caller's own `general` chats by lifecycle state, scoped to the
 * given org. Powers the "manage all my chats" settings section so it can show
 * how many chats a bulk archive/delete would touch and disable the actions
 * when there's nothing to sweep. Branches and other chat types are excluded
 * to match what the chat history sidebar shows.
 */
export const countMyChats = query({
  args: { organizationId: v.optional(v.string()) },
  returns: v.object({ active: v.number(), archived: v.number() }),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return { active: 0, archived: 0 };

    const rows = await ctx.db
      .query('threadMetadata')
      .withIndex('by_userId_chatType_status', (q) =>
        q.eq('userId', authUser.userId).eq('chatType', 'general'),
      )
      .collect();

    let active = 0;
    let archived = 0;
    for (const row of rows) {
      if (row.isBranch === true) continue;
      if (args.organizationId && row.organizationId !== args.organizationId) {
        continue;
      }
      if (row.status === 'active') active += 1;
      else if (row.status === 'archived') archived += 1;
    }
    return { active, archived };
  },
});

export { getSharedThread } from './get_shared_thread';

export const getThreadBranches = query({
  args: {
    rootThreadId: v.string(),
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return [];

    const rootMetadata = await canAccessThread(
      ctx,
      args.rootThreadId,
      authUser,
      args.organizationId,
    );
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
  args: {
    threadId: v.string(),
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;

    const metadata = await canAccessThread(
      ctx,
      args.threadId,
      authUser,
      args.organizationId,
    );
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

    // canAccessThread blocks trashed/expired/deleted threads — share
    // status on a trashed thread is meaningless and surfaces stale
    // shareTokens to the UI.
    const metadata = await canAccessThread(ctx, args.threadId, authUser);
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

    const metadata = await canAccessThread(ctx, args.threadId, authUser);
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

    const metadata = await canAccessThread(ctx, args.threadId, authUser);
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
      forkedAt: metadata.forkedAt ?? null,
    };
  },
});

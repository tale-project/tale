import { listMessages } from '@convex-dev/agent';
import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import { components } from '../_generated/api';
import { query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls';
import {
  canAccessThread,
  canAccessThreadOrSubThread,
} from '../lib/rls/auth/can_access_thread';
import { autoRouteReasonValidator } from '../streaming/validators';
import { isGenerationFresh } from './generation_liveness';
import { getThreadMessages as getThreadMessagesHelper } from './get_thread_messages';
import {
  emptyStreamsResult,
  getThreadMessagesStreaming as getThreadMessagesStreamingHelper,
} from './get_thread_messages_streaming';
import { listArchivedThreads as listArchivedThreadsHelper } from './list_archived_threads';
import {
  isHiddenFromChatHistory,
  listThreads as listThreadsHelper,
} from './list_threads';

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

export const isThreadGenerating = query({
  args: { threadId: v.string(), organizationId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return false;

    // canAccessThread rejects trashed/expired/deleted threads as well as
    // non-owners — without it, an owner querying their own trashed thread
    // still saw `generating` until Pass-B physically deleted the row
    // (round-2 v15 H8). `organizationId` is the active org, scoping the thread
    // to the org the caller is acting in (see canAccessThread).
    const metadata = await canAccessThread(
      ctx,
      args.threadId,
      authUser,
      args.organizationId,
    );
    if (!metadata) return false;
    if (metadata.generationStatus !== 'generating') return false;

    // Guard against stuck generationStatus: if the action crashed without
    // cleanup, the liveness timestamps let us detect staleness and unblock
    // the client instead of requiring a page refresh.
    return isGenerationFresh(metadata);
  },
});

export const getThreadMessages = query({
  args: { threadId: v.string(), organizationId: v.string() },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return { messages: [] };
    }
    // Mirror the streaming sibling at `getThreadMessagesStreaming`. Without
    // this gate, any signed-in user with a threadId could read every
    // message — bypasses owner / org / isShared / trashed checks and
    // relies on UUID secrecy for authorization. canAccessThread enforces
    // the same allow-list the streaming path already uses, scoped to the
    // active `organizationId`.
    const metadata = await canAccessThread(
      ctx,
      args.threadId,
      authUser,
      args.organizationId,
    );
    if (!metadata) {
      return { messages: [] };
    }
    return await getThreadMessagesHelper(ctx, args.threadId);
  },
});

export const getThreadMessagesStreaming = query({
  args: {
    threadId: v.string(),
    organizationId: v.string(),
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
        streams: emptyStreamsResult(args.streamArgs),
      };
    }

    // `OrSubThread`: the chat UI streams a delegated sub-agent's thread to
    // render its live nested timeline, and sub-threads have no threadMetadata
    // row — authorize them via their parent thread (see helper docs).
    const metadata = await canAccessThreadOrSubThread(
      ctx,
      args.threadId,
      authUser,
      args.organizationId,
    );
    if (!metadata) {
      return {
        page: [],
        isDone: true,
        continueCursor: '',
        streams: emptyStreamsResult(args.streamArgs),
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
  args: { threadId: v.string(), organizationId: v.string() },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return {};

    // canAccessThread blocks trashed/expired/deleted threads — error
    // strings can leak PII the user thought they trashed. Scoped to the
    // active `organizationId`.
    const metadata = await canAccessThread(
      ctx,
      args.threadId,
      authUser,
      args.organizationId,
    );
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
  args: { threadId: v.string(), organizationId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      projectId: v.union(v.id('projects'), v.null()),
      isGenerating: v.boolean(),
      // Park-on-capacity: the turn is generating but WAITING for a free sandbox
      // slot (org at its concurrency cap). The composer shows "Queued for
      // capacity" instead of "Thinking". Always false unless isGenerating.
      isQueued: v.boolean(),
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
      // External-agent plan/act posture (composer toggle + plan-card flow).
      // `null` when the row has no explicit mode — callers treat it as 'act'.
      externalAgentMode: v.union(v.literal('plan'), v.literal('act'), v.null()),
      // The agent this thread last ran on (stamped every pinned turn). The
      // composer uses it to pin external-agent threads to their agent — the
      // sandbox session and --resume transcript are bound to it, so the
      // global (per-user) picker state must not re-route such a thread.
      agentSlug: v.union(v.string(), v.null()),
    }),
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

    // Live generation status (mirrors isThreadGenerating, incl. stale guard).
    const isGenerating =
      metadata.generationStatus === 'generating' && isGenerationFresh(metadata);
    // Park-on-capacity: queued only while genuinely generating (the stale guard
    // above prevents a leftover flag surfacing on an idle thread).
    const isQueued = isGenerating && metadata.generationQueuedSince != null;

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
      isQueued,
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
      externalAgentMode: metadata.externalAgentMode ?? null,
      agentSlug: metadata.agentSlug ?? null,
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
      // Branches and discussions live outside the chat-history sidebar, so the
      // count must skip them to match what the sidebar shows and what a bulk
      // archive/delete would actually touch.
      if (isHiddenFromChatHistory(row)) continue;
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
  args: { threadId: v.string(), organizationId: v.string() },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return { isShared: false, shareToken: null };
    }

    // canAccessThread blocks trashed/expired/deleted threads — share
    // status on a trashed thread is meaningless and surfaces stale
    // shareTokens to the UI. Scoped to the active `organizationId`.
    const metadata = await canAccessThread(
      ctx,
      args.threadId,
      authUser,
      args.organizationId,
    );
    if (!metadata || metadata.userId !== authUser.userId) {
      return { isShared: false, shareToken: null };
    }

    return {
      isShared: metadata.isShared ?? false,
      shareToken: metadata.shareToken ?? null,
      sharedAt: metadata.sharedAt ?? null,
      // Mirror the guards in `shareThread` so the dialog can disable the
      // toggle up front instead of only surfacing a failure after the fact
      // (#2086). Arena and branch threads can't be shared, and an archived
      // thread's share link is meaningless.
      isShareable:
        !metadata.arenaGroupId &&
        !metadata.isBranch &&
        metadata.status !== 'archived',
    };
  },
});

export const getArenaThreadPair = query({
  args: { threadId: v.string(), organizationId: v.string() },
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

    const metadata = await canAccessThread(
      ctx,
      args.threadId,
      authUser,
      args.organizationId,
    );
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
  args: { threadId: v.string(), organizationId: v.string() },
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

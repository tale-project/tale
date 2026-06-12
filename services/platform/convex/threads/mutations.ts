import { listMessages, saveMessage, type MessageDoc } from '@convex-dev/agent';
import { v } from 'convex/values';

import { components, internal } from '../_generated/api';
import { internalMutation, mutation } from '../_generated/server';
import {
  assertThreadAccess,
  canAccessThread,
} from '../lib/rls/auth/can_access_thread';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { cascadeDeleteMessageChildren } from '../tts/cascade_helpers';
import {
  archiveChatThread as archiveChatThreadHelper,
  unarchiveChatThread as unarchiveChatThreadHelper,
} from './archive_chat_thread';
import {
  assertBulkActionAllowed,
  collectBulkActionThreadIds,
} from './bulk_thread_actions';
import { cancelGeneration as cancelGenerationHelper } from './cancel_generation';
import { createChatThread as createChatThreadHelper } from './create_chat_thread';
import { deleteChatThread as deleteChatThreadHelper } from './delete_chat_thread';
import { getThreadMessages } from './get_thread_messages';
import { updateChatThread as updateChatThreadHelper } from './update_chat_thread';

/**
 * List ALL messages (including tool, system, etc.) from a thread in chronological order.
 * Unlike getThreadMessages which filters to user/assistant only, this preserves everything.
 */
async function listAllMessages(
  ctx: Parameters<typeof listMessages>[0],
  threadId: string,
): Promise<MessageDoc[]> {
  const allMessages: MessageDoc[] = [];
  let cursor: string | null = null;
  let isDone = false;

  while (!isDone) {
    const result = await listMessages(ctx, components.agent, {
      threadId,
      paginationOpts: { cursor, numItems: 100 },
      excludeToolMessages: false,
    });
    allMessages.push(...result.page);
    cursor = result.continueCursor;
    isDone = result.isDone;
  }

  // listMessages returns newest-first, reverse for chronological order
  allMessages.reverse();
  return allMessages;
}

export const createChatThread = mutation({
  args: {
    organizationId: v.string(),
    title: v.optional(v.string()),
    chatType: v.optional(
      v.union(
        v.literal('general'),
        v.literal('workflow_assistant'),
        v.literal('agent_test'),
      ),
    ),
    arenaGroupId: v.optional(v.string()),
    arenaModelId: v.optional(v.string()),
    isBranch: v.optional(v.boolean()),
    forkedFrom: v.optional(v.string()),
    teamId: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const threadId = await createChatThreadHelper(
      ctx,
      authUser.userId,
      args.title,
      args.chatType ?? 'general',
      args.arenaGroupId && args.arenaModelId
        ? {
            arenaGroupId: args.arenaGroupId,
            arenaModelId: args.arenaModelId,
            isBranch: args.isBranch ?? false,
            forkedFrom: args.forkedFrom,
          }
        : undefined,
      args.teamId,
      args.organizationId,
    );

    return threadId;
  },
});

/**
 * Create a fresh arena Thread B branched from Thread A with its current
 * message history. Called each time arena mode is enabled on an existing
 * thread — always creates a new branch so the history snapshot is fresh
 * (the user may have continued chatting on Thread A since the last arena session).
 *
 * Idempotent within a single arena session via the client-side
 * `ensuringThreadBRef` guard.
 */
export const createArenaThreadB = mutation({
  args: {
    threadIdA: v.string(),
    organizationId: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const metaA = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadIdA))
      .first();
    if (!metaA || metaA.userId !== authUser.userId) {
      throw new Error('Thread not found');
    }

    // Each arena session gets a fresh group ID
    const arenaGroupId = crypto.randomUUID();

    // Tag Thread A with the new arena group
    await ctx.db.patch(metaA._id, { arenaGroupId });

    // Create Thread B as a branch of Thread A
    const threadIdB = await createChatThreadHelper(
      ctx,
      authUser.userId,
      metaA.title ?? '',
      metaA.chatType ?? 'general',
      {
        arenaGroupId,
        arenaModelId: '',
        isBranch: true,
        forkedFrom: args.threadIdA,
      },
      metaA.teamId,
      args.organizationId,
    );

    // Copy current conversation history from Thread A → Thread B (all message types)
    const allMessages = await listAllMessages(ctx, args.threadIdA);
    for (const msg of allMessages) {
      if (!msg.message) continue;
      await saveMessage(ctx, components.agent, {
        threadId: threadIdB,
        userId: authUser.userId,
        message: msg.message,
      });
    }

    return threadIdB;
  },
});

export const deleteChatThread = mutation({
  args: {
    threadId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await getAuthUserIdentity(ctx);
    if (!identity) {
      throw new Error('Unauthenticated');
    }

    // Cross-tenant gate: verify the caller can read this thread before any
    // mutation runs. The helper itself only checks legal-hold (using the
    // target row's own orgId) and is otherwise blind to caller identity, so
    // without this assertion any signed-in user could trash any thread by
    // guessing the threadId. assertThreadAccess matches the same gate used
    // by every read and by other thread mutations.
    await assertThreadAccess(ctx, args.threadId, identity);

    await deleteChatThreadHelper(ctx, args.threadId);
    return null;
  },
});

export const updateChatThread = mutation({
  args: {
    threadId: v.string(),
    title: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await getAuthUserIdentity(ctx);
    if (!identity) {
      throw new Error('Unauthenticated');
    }

    // Cross-tenant gate, same rationale as deleteChatThread above:
    // updateChatThreadHelper looks up by threadId and is blind to caller
    // identity, so any signed-in user could rename any thread without
    // this assertion.
    await assertThreadAccess(ctx, args.threadId, identity);

    await updateChatThreadHelper(ctx, args.threadId, args.title);
    return null;
  },
});

export const cancelGeneration = mutation({
  args: {
    threadId: v.string(),
    displayedLength: v.optional(v.union(v.number(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await cancelGenerationHelper(
      ctx,
      authUser.userId,
      args.threadId,
      args.displayedLength,
      // User-facing Stop: queued messages auto-resume as the next turn.
      { drainQueue: true },
    );
    return null;
  },
});

export const archiveChatThread = mutation({
  args: {
    threadId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await getAuthUserIdentity(ctx);
    if (!identity) {
      throw new Error('Unauthenticated');
    }

    // Cross-tenant gate, same rationale as deleteChatThread above:
    // archiveChatThreadHelper is blind to caller identity, so without
    // this assertion any signed-in user could archive any thread by
    // guessing the threadId.
    await assertThreadAccess(ctx, args.threadId, identity);

    await archiveChatThreadHelper(ctx, args.threadId);
    return null;
  },
});

export const unarchiveChatThread = mutation({
  args: {
    threadId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await getAuthUserIdentity(ctx);
    if (!identity) {
      throw new Error('Unauthenticated');
    }

    // Cross-tenant gate, same rationale as archiveChatThread above.
    await assertThreadAccess(ctx, args.threadId, identity);

    await unarchiveChatThreadHelper(ctx, args.threadId);
    return null;
  },
});

/**
 * Soft-delete (move to Trash) every one of the caller's own general chats —
 * the "Delete all chats" action in account settings. Collects the matching
 * thread ids, then hands them to a scheduled batch processor so a large
 * history doesn't blow the per-mutation read/write budget. Returns the number
 * of chats scheduled for deletion (0 = nothing to do). The chat list updates
 * reactively as each batch flips threads to `'trashed'`.
 *
 * Explicit return type: this mutation references `internal.*` via the
 * scheduler, so without the annotation TS would chase a circular type through
 * the generated api.
 */
export const deleteAllChatThreads = mutation({
  args: {
    organizationId: v.optional(v.string()),
  },
  returns: v.object({ scheduled: v.number() }),
  handler: async (ctx, args): Promise<{ scheduled: number }> => {
    const identity = await getAuthUserIdentity(ctx);
    if (!identity) {
      throw new Error('Unauthenticated');
    }

    await assertBulkActionAllowed(ctx, identity.userId, args.organizationId);

    const threadIds = await collectBulkActionThreadIds(
      ctx,
      identity.userId,
      args.organizationId,
      'delete',
    );

    if (threadIds.length > 0) {
      await ctx.scheduler.runAfter(
        0,
        internal.threads.internal_mutations.processBulkThreadAction,
        {
          threadIds,
          offset: 0,
          action: 'delete',
          userId: identity.userId,
          organizationId: args.organizationId,
        },
      );
    }

    return { scheduled: threadIds.length };
  },
});

/**
 * Archive every one of the caller's own active general chats — the
 * "Archive all chats" action in account settings. Same scheduled-batch
 * approach as `deleteAllChatThreads`; archived chats remain restorable from
 * the archived section. Returns the number of chats scheduled.
 */
export const archiveAllChatThreads = mutation({
  args: {
    organizationId: v.optional(v.string()),
  },
  returns: v.object({ scheduled: v.number() }),
  handler: async (ctx, args): Promise<{ scheduled: number }> => {
    const identity = await getAuthUserIdentity(ctx);
    if (!identity) {
      throw new Error('Unauthenticated');
    }

    await assertBulkActionAllowed(ctx, identity.userId, args.organizationId);

    const threadIds = await collectBulkActionThreadIds(
      ctx,
      identity.userId,
      args.organizationId,
      'archive',
    );

    if (threadIds.length > 0) {
      await ctx.scheduler.runAfter(
        0,
        internal.threads.internal_mutations.processBulkThreadAction,
        {
          threadIds,
          offset: 0,
          action: 'archive',
          userId: identity.userId,
          organizationId: args.organizationId,
        },
      );
    }

    return { scheduled: threadIds.length };
  },
});

/**
 * Persist the canvas (workspace) pane state for a thread. The frontend
 * `WorkspaceProvider` calls this with an optimistic update when the user
 * toggles the pane or switches the active artifact file, so reopening the
 * thread (or visiting from another device) restores the same layout.
 *
 * Both fields are independently optional so a caller can update one without
 * touching the other (e.g. switching files while keeping the pane open).
 * Passing `null` for `canvasActiveFilePath` clears the override — the chat
 * surface will fall back to "first listed file".
 */
export const setThreadCanvasState = mutation({
  args: {
    threadId: v.string(),
    canvasOpen: v.optional(v.boolean()),
    canvasActiveFilePath: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await getAuthUserIdentity(ctx);
    if (!identity) {
      throw new Error('Unauthenticated');
    }

    // Cross-tenant gate, mirrors setThreadPinned / markThreadRead — the row
    // is keyed only by threadId, so without this any signed-in user could
    // mutate another tenant's thread metadata by guessing the id.
    await assertThreadAccess(ctx, args.threadId, identity);

    const metadata = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();
    if (!metadata) return null;

    // `ctx.db.patch` ignores `undefined`, so only the fields the caller
    // explicitly passed (including `null` to clear `canvasActiveFilePath`)
    // are written. `null` is mapped to `undefined` on the way in because
    // the schema field is `v.optional(v.string())` — undefined removes it.
    const patch: {
      canvasOpen?: boolean;
      canvasActiveFilePath?: string | undefined;
    } = {};
    if (args.canvasOpen !== undefined) patch.canvasOpen = args.canvasOpen;
    if (args.canvasActiveFilePath !== undefined) {
      patch.canvasActiveFilePath = args.canvasActiveFilePath ?? undefined;
    }
    if (Object.keys(patch).length === 0) return null;

    await ctx.db.patch(metadata._id, patch);
    return null;
  },
});

export const setThreadPinned = mutation({
  args: {
    threadId: v.string(),
    pinned: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await getAuthUserIdentity(ctx);
    if (!identity) {
      throw new Error('Unauthenticated');
    }

    // Cross-tenant gate, same rationale as the other thread mutations in
    // this file: the row is looked up by threadId and is otherwise blind
    // to caller identity, so without this any signed-in user could pin
    // another tenant's thread by guessing the id.
    await assertThreadAccess(ctx, args.threadId, identity);

    const metadata = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();

    if (metadata) {
      await ctx.db.patch(metadata._id, {
        pinnedAt: args.pinned ? Date.now() : undefined,
      });
    }
    return null;
  },
});

export const setExternalAgentMode = mutation({
  args: {
    threadId: v.string(),
    mode: v.union(v.literal('plan'), v.literal('act')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await getAuthUserIdentity(ctx);
    if (!identity) {
      throw new Error('Unauthenticated');
    }

    // Cross-tenant gate, same rationale as setThreadPinned: the row is
    // looked up by threadId and is otherwise blind to caller identity.
    await assertThreadAccess(ctx, args.threadId, identity);

    const metadata = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();

    if (metadata) {
      await ctx.db.patch(metadata._id, { externalAgentMode: args.mode });
    }
    return null;
  },
});

export const markThreadRead = mutation({
  args: {
    threadId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await getAuthUserIdentity(ctx);
    if (!identity) {
      throw new Error('Unauthenticated');
    }

    // Best-effort unread tracking — never throw. `markThreadRead` fires on
    // navigation and can race a delete/archive or target a thread the caller
    // can only transiently see; a thrown `forbidden` surfaced as an uncaught
    // mutation error in the console. It's also the *owner's* read state, so
    // only the owner updates `lastReadAt`; non-owners (shared viewers) no-op.
    const metadata = await canAccessThread(ctx, args.threadId, identity);
    if (!metadata || metadata.userId !== identity.userId) {
      return null;
    }

    await ctx.db.patch(metadata._id, { lastReadAt: Date.now() });
    return null;
  },
});

export const updateBranchSelections = mutation({
  args: {
    threadId: v.string(),
    branchSelections: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await getAuthUserIdentity(ctx);
    if (!identity) {
      throw new Error('Unauthenticated');
    }

    // Cross-tenant gate: without this, any authenticated user could
    // overwrite any thread's branchSelections by guessing the threadId.
    // Matches the pattern used by every other thread mutation in this
    // file (delete/archive/unarchive/cancelGeneration/updateChatThread).
    await assertThreadAccess(ctx, args.threadId, identity);

    const metadata = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();

    if (metadata) {
      await ctx.db.patch(metadata._id, {
        branchSelections: args.branchSelections,
      });
    }
    return null;
  },
});

/**
 * Copies all messages from one thread to another (including tool, system, etc.).
 * Used when enabling arena mode on an existing thread — Thread B needs
 * the same conversation history as Thread A.
 */
export const copyThreadMessages = internalMutation({
  args: {
    sourceThreadId: v.string(),
    targetThreadId: v.string(),
    userId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const allMessages = await listAllMessages(ctx, args.sourceThreadId);

    for (const msg of allMessages) {
      if (!msg.message) continue;
      await saveMessage(ctx, components.agent, {
        threadId: args.targetThreadId,
        userId: args.userId,
        message: msg.message,
      });
    }

    return null;
  },
});

/**
 * Creates a branch link between arena thread A (root) and thread B (branch).
 * Called by arenaChat action after both chatWithAgent calls complete.
 */
export const createArenaBranchLink = internalMutation({
  args: {
    rootThreadId: v.string(),
    branchThreadId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Idempotent: one arena session ↔ one branch link, regardless of round count.
    const existing = await ctx.db
      .query('threadBranches')
      .withIndex('by_branchThreadId', (q) =>
        q.eq('branchThreadId', args.branchThreadId),
      )
      .first();
    if (existing) return null;

    const { messages } = await getThreadMessages(ctx, args.rootThreadId);

    const userMessages = messages.filter((m) => m.role === 'user');
    const lastUserMessage = userMessages[userMessages.length - 1];

    if (!lastUserMessage) {
      throw new Error('No user message found in root thread');
    }

    // Count user messages to determine forkOrder (0-based)
    const forkOrder = userMessages.length - 1;

    await ctx.db.insert('threadBranches', {
      rootThreadId: args.rootThreadId,
      branchThreadId: args.branchThreadId,
      parentThreadId: args.rootThreadId,
      forkAfterMessageId: lastUserMessage._id,
      forkOrder,
      branchIndex: 1,
      createdAt: Date.now(),
    });

    return null;
  },
});

/**
 * Clean up arena branch when exiting arena mode.
 * If verdict is 'b_better', wipes Thread A and copies all of Thread B's messages into it.
 * Then deletes Thread B, the branch link, and arena metadata.
 */
export const cleanupArenaBranch = mutation({
  args: {
    threadIdA: v.string(),
    threadIdB: v.string(),
    verdict: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    // Verify ownership of Thread A
    const metaA = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadIdA))
      .first();
    if (!metaA || metaA.userId !== authUser.userId) {
      throw new Error('Thread not found');
    }

    // Defense-in-depth: also verify Thread B ownership and arena pairing.
    const metaB = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadIdB))
      .first();
    if (
      !metaB ||
      metaB.userId !== authUser.userId ||
      !metaA.arenaGroupId ||
      metaB.arenaGroupId !== metaA.arenaGroupId
    ) {
      throw new Error('Thread not found');
    }

    // If B won, wipe Thread A and copy all of B's messages into it
    if (args.verdict === 'b_better') {
      // Get all messages from both threads
      const messagesA = await listAllMessages(ctx, args.threadIdA);
      const messagesB = await listAllMessages(ctx, args.threadIdB);

      // Delete all of A's messages
      const messageIdsA = messagesA.map((m) => m._id);
      if (messageIdsA.length > 0) {
        // Cascade A's TTS audio chunks before deleting the messages.
        // Without this, chunks would linger as ghost rows referencing dead
        // `messageId`s until the daily org-sweep cron catches them — the
        // verbatim assistant-voice PII would stay on disk for up to 7 days.
        if (metaA.organizationId) {
          await cascadeDeleteMessageChildren(ctx, {
            messageIds: messageIdsA,
            threadId: args.threadIdA,
            organizationId: metaA.organizationId,
          });
        }
        await ctx.runMutation(components.agent.messages.deleteByIds, {
          messageIds: messageIdsA,
        });
      }

      // Copy all of B's messages into A, preserving metadata that saveMessage
      // accepts. _creationTime is system-assigned on insert and cannot be
      // overridden, so copied messages will have new timestamps; order is
      // preserved by sequential iteration.
      for (const msg of messagesB) {
        if (!msg.message) continue;
        await saveMessage(ctx, components.agent, {
          threadId: args.threadIdA,
          userId: authUser.userId,
          agentName: msg.agentName,
          message: msg.message,
          metadata: {
            fileIds: msg.fileIds,
            finishReason: msg.finishReason,
            model: msg.model,
            provider: msg.provider,
            providerMetadata: msg.providerMetadata,
            sources: msg.sources,
            reasoning: msg.reasoning,
            reasoningDetails: msg.reasoningDetails,
            usage: msg.usage,
            warnings: msg.warnings,
            error: msg.error,
          },
        });
      }
    }

    // Delete Thread B — arena losers are ephemeral internal artifacts.
    // Use the internal-cascade mode so it does NOT enter the user's
    // Trash (the user never saw Thread B as a separate entity).
    await deleteChatThreadHelper(ctx, args.threadIdB, 'internal-cascade');

    // Remove all branch links for Thread B (there may be multiple from old
    // data written before createArenaBranchLink was made idempotent).
    for await (const record of ctx.db
      .query('threadBranches')
      .withIndex('by_branchThreadId', (q) =>
        q.eq('branchThreadId', args.threadIdB),
      )) {
      await ctx.db.delete(record._id);
    }

    // Clean up arena metadata on Thread A
    await ctx.db.patch(metaA._id, {
      arenaGroupId: undefined,
      branchSelections: undefined,
    });

    return null;
  },
});

export { shareThread, unshareThread } from './share_thread';
export { forkThread } from './fork_thread';
export { forkOwnThread } from './fork_own_thread';
export { forkAndChat } from './fork_and_chat';
export { editAndBranch } from './edit_and_branch';

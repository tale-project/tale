import { listMessages, saveMessage, type MessageDoc } from '@convex-dev/agent';
import { v } from 'convex/values';

import { components } from '../_generated/api';
import { internalMutation, mutation } from '../_generated/server';
import { authComponent } from '../auth';
import {
  archiveChatThread as archiveChatThreadHelper,
  unarchiveChatThread as unarchiveChatThreadHelper,
} from './archive_chat_thread';
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
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const threadId = await createChatThreadHelper(
      ctx,
      authUser._id,
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
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const metaA = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadIdA))
      .first();
    if (!metaA || metaA.userId !== authUser._id) {
      throw new Error('Thread not found');
    }

    // Each arena session gets a fresh group ID
    const arenaGroupId = crypto.randomUUID();

    // Tag Thread A with the new arena group
    await ctx.db.patch(metaA._id, { arenaGroupId });

    // Create Thread B as a branch of Thread A
    const threadIdB = await createChatThreadHelper(
      ctx,
      authUser._id,
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
        userId: authUser._id,
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
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

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
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await updateChatThreadHelper(ctx, args.threadId, args.title);
    return null;
  },
});

export const cancelGeneration = mutation({
  args: {
    threadId: v.string(),
    displayedContent: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await cancelGenerationHelper(
      ctx,
      String(authUser._id),
      args.threadId,
      args.displayedContent,
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
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

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
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await unarchiveChatThreadHelper(ctx, args.threadId);
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
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

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
    // Find the last user message in the root thread to use as fork point
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
 * Updates the content of an assistant message in a thread.
 * Used by the Canvas "Apply" feature to write edited content back.
 */
export const updateMessageContent = mutation({
  args: {
    messageId: v.string(),
    content: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await ctx.runMutation(components.agent.messages.updateMessage, {
      messageId: args.messageId,
      patch: {
        message: { role: 'assistant', content: args.content },
      },
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
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    // Verify ownership of Thread A
    const metaA = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadIdA))
      .first();
    if (!metaA || metaA.userId !== authUser._id) {
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
        await ctx.runMutation(components.agent.messages.deleteByIds, {
          messageIds: messageIdsA,
        });
      }

      // Copy all of B's messages into A
      for (const msg of messagesB) {
        if (!msg.message) continue;
        await saveMessage(ctx, components.agent, {
          threadId: args.threadIdA,
          userId: authUser._id,
          message: msg.message,
        });
      }
    }

    // Delete Thread B
    await deleteChatThreadHelper(ctx, args.threadIdB);

    // Remove the branch link
    const branchRecord = await ctx.db
      .query('threadBranches')
      .withIndex('by_branchThreadId', (q) =>
        q.eq('branchThreadId', args.threadIdB),
      )
      .first();
    if (branchRecord) {
      await ctx.db.delete(branchRecord._id);
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

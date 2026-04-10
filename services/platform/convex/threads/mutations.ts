import { v } from 'convex/values';

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
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    return await createChatThreadHelper(
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
    );
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

export { shareThread, unshareThread } from './share_thread';
export { forkThread } from './fork_thread';
export { forkOwnThread } from './fork_own_thread';
export { forkAndChat } from './fork_and_chat';
export { editAndBranch } from './edit_and_branch';

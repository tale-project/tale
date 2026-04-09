import { createThread, saveMessage } from '@convex-dev/agent';
import { v } from 'convex/values';

import { components } from '../_generated/api';
import { internalMutation } from '../_generated/server';
import { getThreadMessages } from './get_thread_messages';

export const createBranchThread = internalMutation({
  args: {
    userId: v.string(),
    sourceThreadId: v.string(),
    rootThreadId: v.string(),
    editedMessageId: v.string(),
    editedMessageOrder: v.number(),
    newMessage: v.string(),
  },
  returns: v.object({
    branchThreadId: v.string(),
    forkOrder: v.number(),
  }),
  handler: async (ctx, args) => {
    const sourceMetadata = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.sourceThreadId))
      .first();

    if (!sourceMetadata) {
      throw new Error('Source thread not found');
    }

    if (sourceMetadata.userId !== args.userId) {
      throw new Error('Not authorized to branch this thread');
    }

    // Count existing branches at this fork point for branchIndex
    let branchCount = 0;
    const existingBranches = ctx.db
      .query('threadBranches')
      .withIndex('by_parentThreadId_forkAfterMessageId', (q) =>
        q
          .eq('parentThreadId', args.sourceThreadId)
          .eq('forkAfterMessageId', args.editedMessageId),
      );
    for await (const _ of existingBranches) {
      branchCount++;
    }

    // Create new SDK thread
    const branchThreadId = await createThread(ctx, components.agent, {
      userId: args.userId,
      title: sourceMetadata.title ?? 'New Chat',
      summary: JSON.stringify({ chatType: sourceMetadata.chatType }),
    });

    const thread = await ctx.runQuery(components.agent.threads.getThread, {
      threadId: branchThreadId,
    });
    const createdAt = thread?._creationTime ?? Date.now();

    // Create threadMetadata for the branch (hidden from sidebar)
    await ctx.db.insert('threadMetadata', {
      threadId: branchThreadId,
      userId: args.userId,
      chatType: sourceMetadata.chatType,
      status: 'active',
      title: sourceMetadata.title,
      createdAt,
      updatedAt: createdAt,
      agentSlug: sourceMetadata.agentSlug,
      isBranch: true,
      forkedFrom: args.sourceThreadId,
    });

    // Create threadBranches record
    await ctx.db.insert('threadBranches', {
      rootThreadId: args.rootThreadId,
      branchThreadId,
      parentThreadId: args.sourceThreadId,
      forkAfterMessageId: args.editedMessageId,
      forkOrder: args.editedMessageOrder,
      branchIndex: branchCount + 1,
      createdAt,
    });

    // Copy messages from source up to (but not including) the edited message,
    // then append the new edited message content.
    // Use getThreadMessages + saveMessage (same pattern as fork_thread.ts)
    // to guarantee correct chronological ordering.
    const { messages } = await getThreadMessages(ctx, args.sourceThreadId);

    for (const msg of messages) {
      // Stop before the edited message
      if (msg._id === args.editedMessageId) break;
      await saveMessage(ctx, components.agent, {
        threadId: branchThreadId,
        userId: args.userId,
        message: {
          role: msg.role,
          content: msg.content,
        },
      });
    }

    // Save the edited user message
    await saveMessage(ctx, components.agent, {
      threadId: branchThreadId,
      userId: args.userId,
      message: {
        role: 'user',
        content: args.newMessage,
      },
    });

    return { branchThreadId, forkOrder: args.editedMessageOrder };
  },
});

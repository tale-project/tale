import { createThread, saveMessage } from '@convex-dev/agent';
import { v } from 'convex/values';

import { components } from '../_generated/api';
import { mutation } from '../_generated/server';
import { authComponent } from '../auth';
import { getThreadMessages } from './get_thread_messages';

export const forkOwnThread = mutation({
  args: {
    threadId: v.string(),
    upToMessageOrder: v.optional(v.number()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const metadata = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();

    if (!metadata) {
      throw new Error('Thread not found');
    }

    const userId = String(authUser._id);
    if (metadata.userId !== userId) {
      throw new Error('Not authorized to fork this thread');
    }

    const { messages: allMessages } = await getThreadMessages(
      ctx,
      metadata.threadId,
    );

    // Fork up to a specific message (by turn order), or all messages.
    // Uses `order` (turn-level, stable regardless of tool-message filtering)
    // instead of UIMessage.id (which differs between streaming and
    // excludeToolMessages queries — see get_thread_messages_streaming.ts).
    const cutoffOrder = args.upToMessageOrder;
    const messages =
      cutoffOrder !== undefined
        ? allMessages.filter((m) => m.order <= cutoffOrder)
        : allMessages;

    const title = metadata.title ? `Fork of ${metadata.title}` : 'Forked chat';

    const newThreadId = await createThread(ctx, components.agent, {
      userId,
      title,
    });

    const thread = await ctx.runQuery(components.agent.threads.getThread, {
      threadId: newThreadId,
    });

    const createdAt = thread?._creationTime ?? Date.now();
    await ctx.db.insert('threadMetadata', {
      threadId: newThreadId,
      userId,
      chatType: 'general',
      status: 'active',
      title,
      createdAt,
      updatedAt: createdAt,
      forkedFrom: metadata.threadId,
      forkedMessageCount: messages.length,
      lastForkedMessageOrder: messages.at(-1)?.order,
      ...(metadata.teamId && { teamId: metadata.teamId }),
    });

    for (const msg of messages) {
      await saveMessage(ctx, components.agent, {
        threadId: newThreadId,
        userId,
        message: {
          role: msg.role,
          content: msg.content,
        },
      });
    }

    return newThreadId;
  },
});

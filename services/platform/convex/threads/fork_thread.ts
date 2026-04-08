import { createThread, saveMessage } from '@convex-dev/agent';
import { v } from 'convex/values';

import { components } from '../_generated/api';
import { mutation } from '../_generated/server';
import { authComponent } from '../auth';
import { getThreadMessages } from './get_thread_messages';

export const forkThread = mutation({
  args: {
    shareToken: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const metadata = await ctx.db
      .query('threadMetadata')
      .withIndex('by_shareToken', (q) => q.eq('shareToken', args.shareToken))
      .first();

    if (!metadata || !metadata.isShared) {
      throw new Error('Shared thread not found');
    }

    const { messages } = await getThreadMessages(ctx, metadata.threadId);

    const userId = String(authUser._id);
    const title = metadata.title ? `Fork of ${metadata.title}` : 'Forked chat';

    const newThreadId = await createThread(ctx, components.agent, {
      userId,
      title,
    });

    const thread = await ctx.runQuery(components.agent.threads.getThread, {
      threadId: newThreadId,
    });

    await ctx.db.insert('threadMetadata', {
      threadId: newThreadId,
      userId,
      chatType: 'general',
      status: 'active',
      title,
      createdAt: thread?._creationTime ?? Date.now(),
      forkedFrom: metadata.threadId,
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

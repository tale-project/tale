import { createThread, saveMessage } from '@convex-dev/agent';
import { v } from 'convex/values';

import { components } from '../_generated/api';
import { mutation } from '../_generated/server';
import { authComponent } from '../auth';
import { isOrgMember } from '../lib/rls/auth/check_org_membership';
import { getThreadMessages } from './get_thread_messages';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

    if (!UUID_REGEX.test(args.shareToken)) {
      throw new Error('Invalid share token');
    }

    const metadata = await ctx.db
      .query('threadMetadata')
      .withIndex('by_shareToken', (q) => q.eq('shareToken', args.shareToken))
      .first();

    if (!metadata || !metadata.isShared) {
      throw new Error('Shared thread not found');
    }

    // Org-scoped access: verify the forking user is in the same org
    if (metadata.organizationId) {
      const isMember = await isOrgMember(
        ctx,
        String(authUser._id),
        metadata.organizationId,
      );
      if (!isMember) {
        throw new Error('Shared thread not found');
      }
    }

    const { messages: allMessages } = await getThreadMessages(
      ctx,
      metadata.threadId,
    );

    // Snapshot: only include messages up to the share timestamp
    const sharedAt = metadata.sharedAt;
    const messages = sharedAt
      ? allMessages.filter((m) => m._creationTime <= sharedAt)
      : allMessages;

    const userId = String(authUser._id);
    const title = metadata.title ? `Fork of ${metadata.title}` : 'Forked chat';

    const newThreadId = await createThread(ctx, components.agent, {
      userId,
      title,
    });

    const thread = await ctx.runQuery(components.agent.threads.getThread, {
      threadId: newThreadId,
    });

    let lastSavedOrder: number | undefined;
    for (const msg of messages) {
      const result = await saveMessage(ctx, components.agent, {
        threadId: newThreadId,
        userId,
        message: {
          role: msg.role,
          content: msg.content,
        },
      });
      lastSavedOrder = result.message.order;
    }

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
      forkedFromShare: true,
      forkedMessageCount: messages.length,
      lastForkedMessageOrder: lastSavedOrder,
      forkedAt: Date.now(),
      // Forking another user's shared thread: don't inject the forker's
      // personalization into a context whose prior messages were authored
      // by someone else. Mirrors the auto-disable on share.
      disablePersonalization: true,
      ...(metadata.organizationId && {
        organizationId: metadata.organizationId,
      }),
    });

    return newThreadId;
  },
});

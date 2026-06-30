import { createThread, saveMessage } from '@convex-dev/agent';
import { ConvexError, v } from 'convex/values';

import { components, internal } from '../_generated/api';
import { mutation } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getThreadMessages } from './get_thread_messages';
import { copyThreadTodos } from './snapshot_thread_todos';

export const forkOwnThread = mutation({
  args: {
    threadId: v.string(),
    upToMessageOrder: v.optional(v.number()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'UNAUTHENTICATED',
        message: 'Unauthenticated',
      });
    }

    const metadata = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();

    if (!metadata) {
      throw new ConvexError({
        code: 'THREAD_NOT_FOUND',
        message: 'Thread not found',
      });
    }

    const userId = authUser.userId;
    if (metadata.userId !== userId) {
      throw new ConvexError({
        code: 'NOT_AUTHORIZED',
        message: 'Not authorized to fork this thread',
      });
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

    // Wall-clock cut for the workspace snapshot on a partial fork. `threadFiles`
    // has no message linkage, so we slice files by `updatedAt` (mirrors the
    // branch cut in thread_files/queries.ts): keep only files last touched at or
    // before the latest carried-over message's `_creationTime`. Undefined for a
    // full fork (copy everything). An empty carried window (e.g. a cutoff before
    // any message) yields 0 — copy nothing — NOT undefined, which would widen
    // the partial fork back into a full-workspace snapshot.
    const cutoffCreatedAt =
      cutoffOrder === undefined
        ? undefined
        : messages.reduce(
            (max, m) => (m._creationTime > max ? m._creationTime : max),
            0,
          );

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
    const organizationId = metadata.organizationId;
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
      lastForkedMessageOrder: lastSavedOrder,
      forkedAt: Date.now(),
      // Org-bind the fork so it's scoped for retention/listing the same way the
      // source is — and so the workspace snapshot below (which requires an org)
      // can run. The field is optional, so a legacy org-less source just omits it.
      ...(organizationId && { organizationId }),
      ...(metadata.disablePersonalization === true && {
        disablePersonalization: true,
      }),
      ...(metadata.teamId && { teamId: metadata.teamId }),
    });

    // Snapshot the source workspace onto the fork: a diverging copy keeps the
    // files + plan it forked with, but stays decoupled from the source's later
    // edits. Files copy bytes via a scheduled action (mutations can't store
    // blobs); todos copy synchronously here. Skipped for legacy org-less
    // threads — there's nothing org-scoped to copy and the file copy needs an org.
    if (organizationId) {
      await ctx.scheduler.runAfter(
        0,
        internal.threads.snapshot_thread_files.snapshotThreadFiles,
        {
          sourceThreadId: metadata.threadId,
          newThreadId,
          organizationId,
          userId,
          ...(cutoffCreatedAt !== undefined && {
            createdAtCutoff: cutoffCreatedAt,
          }),
        },
      );
      // The plan is a single mutable doc with no per-message history, so a
      // partial fork can't faithfully reconstruct the plan as-of-cutoff —
      // copying the current plan would carry over todos from after the cutoff.
      // Only snapshot the plan for a full fork; a partial fork starts planless.
      if (cutoffOrder === undefined) {
        await copyThreadTodos(ctx, {
          sourceThreadId: metadata.threadId,
          newThreadId,
          organizationId,
        });
      }
    }

    return newThreadId;
  },
});

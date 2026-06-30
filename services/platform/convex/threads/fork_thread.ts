import { createThread, saveMessage } from '@convex-dev/agent';
import { ConvexError, v } from 'convex/values';

import { components, internal } from '../_generated/api';
import { mutation } from '../_generated/server';
import { isOrgMember } from '../lib/rls/auth/check_org_membership';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getThreadMessages } from './get_thread_messages';
import { copyThreadTodos } from './snapshot_thread_todos';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const forkThread = mutation({
  args: {
    shareToken: v.string(),
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

    if (!UUID_REGEX.test(args.shareToken)) {
      throw new ConvexError({
        code: 'INVALID_SHARE_TOKEN',
        message: 'Invalid share token',
      });
    }

    const metadata = await ctx.db
      .query('threadMetadata')
      .withIndex('by_shareToken', (q) => q.eq('shareToken', args.shareToken))
      .first();

    if (!metadata || !metadata.isShared) {
      throw new ConvexError({
        code: 'SHARED_THREAD_NOT_FOUND',
        message: 'Shared thread not found',
      });
    }

    // Org-scoped access: verify the forking user is in the same org
    if (metadata.organizationId) {
      const isMember = await isOrgMember(
        ctx,
        authUser.userId,
        metadata.organizationId,
      );
      if (!isMember) {
        throw new ConvexError({
          code: 'SHARED_THREAD_NOT_FOUND',
          message: 'Shared thread not found',
        });
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

    const userId = authUser.userId;
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
      forkedFromShare: true,
      forkedMessageCount: messages.length,
      lastForkedMessageOrder: lastSavedOrder,
      forkedAt: Date.now(),
      // Forking another user's shared thread: don't inject the forker's
      // personalization into a context whose prior messages were authored
      // by someone else. Mirrors the auto-disable on share.
      disablePersonalization: true,
      ...(organizationId && {
        organizationId,
      }),
    });

    // Snapshot the shared thread's workspace onto the fork. Access is already
    // org-membership-gated above, so a member who can fork can see these files.
    // Cut the files at `sharedAt` (the same boundary the messages above use) so
    // the fork can't inherit files the owner wrote after sharing — `threadFiles`
    // has no per-share linkage, so the cut is by wall-clock `createdAt`.
    if (organizationId) {
      await ctx.scheduler.runAfter(
        0,
        internal.threads.snapshot_thread_files.snapshotThreadFiles,
        {
          sourceThreadId: metadata.threadId,
          newThreadId,
          organizationId,
          userId,
          ...(sharedAt !== undefined && { createdAtCutoff: sharedAt }),
        },
      );
      // The plan is a single mutable doc with no per-share history. When the
      // thread carries a `sharedAt` boundary, the current plan may reflect work
      // done after sharing, which we can't faithfully present as-of-share — so
      // skip it (mirrors the partial-fork plan handling in fork_own_thread). A
      // legacy share with no `sharedAt` copies the plan as before.
      if (sharedAt === undefined) {
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

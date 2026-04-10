import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import {
  archiveChatThread as archiveHelper,
  unarchiveChatThread as unarchiveHelper,
} from './archive_chat_thread';
import { cleanupOrphanedSubThreads as cleanupOrphanedSubThreadsHandler } from './cleanup_orphaned_sub_threads';
import { createChatThread as createHelper } from './create_chat_thread';
import { deleteChatThread as deleteHelper } from './delete_chat_thread';
import { getOrCreateSubThread } from './get_or_create_sub_thread';
import { updateChatThread as updateHelper } from './update_chat_thread';

export const getOrCreateSubThreadAtomic = internalMutation({
  args: {
    parentThreadId: v.string(),
    subAgentType: v.string(),
    userId: v.optional(v.string()),
  },
  returns: v.object({
    threadId: v.string(),
    isNew: v.boolean(),
  }),
  handler: async (ctx, args) => {
    return await getOrCreateSubThread(
      ctx,
      args.parentThreadId,
      args.subAgentType,
      args.userId,
    );
  },
});

export const clearGenerationStatus = internalMutation({
  args: { threadId: v.string(), streamId: v.string() },
  handler: async (ctx, args) => {
    const meta = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();
    // Only clear if the streamId matches — prevents a stale action from
    // clearing a newer generation's 'generating' status.
    if (meta && meta.streamId === args.streamId) {
      await ctx.db.patch(meta._id, {
        generationStatus: 'idle',
        streamId: undefined,
      });
    }
  },
});

export const cleanupOrphanedSubThreads = internalMutation({
  args: {
    parentThreadId: v.string(),
    subThreadIds: v.array(v.string()),
  },
  returns: v.object({ archivedCount: v.number() }),
  handler: async (ctx, args) => {
    return await cleanupOrphanedSubThreadsHandler(
      ctx,
      args.parentThreadId,
      args.subThreadIds,
    );
  },
});

// ---------------------------------------------------------------------------
// REST API helpers
// ---------------------------------------------------------------------------

export const createChatThreadInternal = internalMutation({
  args: {
    userId: v.string(),
    title: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    return await createHelper(ctx, args.userId, args.title, 'general');
  },
});

export const updateChatThreadInternal = internalMutation({
  args: {
    threadId: v.string(),
    title: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await updateHelper(ctx, args.threadId, args.title);
    return null;
  },
});

export const deleteChatThreadInternal = internalMutation({
  args: { threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await deleteHelper(ctx, args.threadId);
    return null;
  },
});

export const archiveChatThreadInternal = internalMutation({
  args: { threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await archiveHelper(ctx, args.threadId);
    return null;
  },
});

export const unarchiveChatThreadInternal = internalMutation({
  args: { threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await unarchiveHelper(ctx, args.threadId);
    return null;
  },
});

import { v } from 'convex/values';
import { internalMutation, mutation } from '../_generated/server';
import { getOrCreateSubThread } from './get_or_create_sub_thread';
import { createChatThread as createChatThreadHelper } from './create_chat_thread';
import { deleteChatThread as deleteChatThreadHelper } from './delete_chat_thread';
import { updateChatThread as updateChatThreadHelper } from './update_chat_thread';
import { authComponent } from '../auth';
import { subAgentTypeValidator } from './validators';

export const getOrCreateSubThreadAtomic = internalMutation({
  args: {
    parentThreadId: v.string(),
    subAgentType: subAgentTypeValidator,
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await getOrCreateSubThread(
      ctx,
      args.parentThreadId,
      args.subAgentType,
      args.userId,
    );
  },
});

export const createChatThread = mutation({
  args: {
    organizationId: v.string(),
    title: v.optional(v.string()),
    chatType: v.optional(v.union(v.literal('general'), v.literal('workflow_assistant'))),
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

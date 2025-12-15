import type { ActionCtx } from '../../../../_generated/server';
import { internal } from '../../../../_generated/api';
import type { Id } from '../../../../_generated/dataModel';

export async function updateConversations(
  ctx: ActionCtx,
  params: {
    conversationId: Id<'conversations'>;
    updates: Record<string, unknown>;
  },
) {
  await ctx.runMutation(internal.conversations.updateConversations, {
    conversationId: params.conversationId,
    updates: params.updates,
  });

  // Fetch and return the updated entity
  const updatedConversation = await ctx.runQuery(
    internal.conversations.getConversationById,
    { conversationId: params.conversationId },
  );

  // Note: execute_action_node wraps this in output: { type: 'action', data: result }
  return updatedConversation;
}


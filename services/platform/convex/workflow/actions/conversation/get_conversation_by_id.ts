import type { ActionCtx } from '../../../_generated/server';
import { internal } from '../../../_generated/api';
import type { Id } from '../../../_generated/dataModel';

export async function getConversationById(
  ctx: ActionCtx,
  params: {
    conversationId: Id<'conversations'>;
  },
) {
  const conversation = await ctx.runQuery!(
    internal.conversations.getConversationById,
    {
      conversationId: params.conversationId,
    },
  );

  return {
    operation: 'get_by_id',
    result: conversation,
    found: conversation !== null,
    timestamp: Date.now(),
  };
}


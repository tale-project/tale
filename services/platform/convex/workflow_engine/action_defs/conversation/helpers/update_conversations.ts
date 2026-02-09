import type { Id } from '../../../../_generated/dataModel';
import type { ActionCtx } from '../../../../_generated/server';

import { internal } from '../../../../_generated/api';

export async function updateConversations(
  ctx: ActionCtx,
  params: {
    organizationId: string; // For organization ownership validation
    conversationId: Id<'conversations'>;
    updates: Record<string, unknown>;
  },
) {
  await ctx.runMutation(
    internal.conversations.internal_mutations.updateConversations,
    {
      organizationId: params.organizationId,
      conversationId: params.conversationId,
      updates: params.updates,
    },
  );

  // Fetch and return the updated entity
  const updatedConversation = await ctx.runQuery(
    internal.conversations.internal_queries.getConversationById,
    { conversationId: params.conversationId },
  );

  if (!updatedConversation) {
    throw new Error(
      `Failed to fetch updated conversation with ID "${params.conversationId}"`,
    );
  }

  // Note: execute_action_node wraps this in output: { type: 'action', data: result }
  return updatedConversation;
}

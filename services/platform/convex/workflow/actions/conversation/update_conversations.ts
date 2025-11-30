import type { ActionCtx } from '../../../_generated/server';
import { internal } from '../../../_generated/api';
import type { Id } from '../../../_generated/dataModel';
import type { UpdateConversationsResult, ConversationStatus } from './types';

export async function updateConversations(
  ctx: ActionCtx,
  params: {
    conversationId?: Id<'conversations'>;
    organizationId?: string;
    status?: ConversationStatus;
    priority?: string;
    updates: Record<string, unknown>;
  },
) {
  const result = (await ctx.runMutation(
    internal.conversations.updateConversations,
    {
      conversationId: params.conversationId,
      organizationId: params.organizationId,
      status: params.status,
      priority: params.priority,
      updates: params.updates,
    },
  )) as UpdateConversationsResult;

  return {
    operation: 'update',
    updatedCount: result.updatedCount,
    updatedIds: result.updatedIds,
    success: result.success,
    timestamp: Date.now(),
  };
}

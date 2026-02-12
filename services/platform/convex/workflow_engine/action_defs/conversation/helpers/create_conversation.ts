import type { Id } from '../../../../_generated/dataModel';
import type { ActionCtx } from '../../../../_generated/server';
import type { ConversationStatus, ConversationPriority } from './types';

import { internal } from '../../../../_generated/api';
import { toConvexJsonRecord, toId } from '../../../../lib/type_cast_helpers';

export async function createConversation(
  ctx: ActionCtx,
  params: {
    organizationId: string;
    customerId?: Id<'customers'>;
    subject?: string;
    status?: ConversationStatus;
    priority?: ConversationPriority;
    type?: string;
    channel?: string;
    direction?: 'inbound' | 'outbound';
    metadata?: Record<string, unknown>;
  },
) {
  const result: { success: boolean; conversationId: string } =
    await ctx.runMutation(
      internal.conversations.internal_mutations.createConversation,
      {
        organizationId: params.organizationId,
        customerId: params.customerId,
        subject: params.subject,
        status: params.status,
        priority: params.priority,
        type: params.type,
        channel: params.channel,
        direction: params.direction,
        metadata: params.metadata
          ? toConvexJsonRecord(params.metadata)
          : undefined,
      },
    );

  // Fetch and return the full created entity
  const createdConversation = await ctx.runQuery(
    internal.conversations.internal_queries.getConversationById,
    { conversationId: toId<'conversations'>(result.conversationId) },
  );

  if (!createdConversation) {
    throw new Error(
      `Failed to fetch created conversation with ID "${result.conversationId}" after creation`,
    );
  }

  // Note: execute_action_node wraps this in output: { type: 'action', data: result }
  return createdConversation;
}

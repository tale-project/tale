import type { ActionCtx } from '../../../../_generated/server';
import { internal } from '../../../../_generated/api';
import type { Id } from '../../../../_generated/dataModel';
import type { ConversationStatus } from './types';

export async function createConversation(
  ctx: ActionCtx,
  params: {
    organizationId: string;
    customerId?: Id<'customers'>;
    subject?: string;
    status?: ConversationStatus;
    priority?: string;
    type?: string;
    channel?: string;
    direction?: 'inbound' | 'outbound';
    providerId?: Id<'emailProviders'>;
    metadata?: Record<string, unknown>;
  },
) {
  const result: { success: boolean; conversationId: string } =
    await ctx.runMutation(internal.conversations.createConversation, {
      organizationId: params.organizationId,
      customerId: params.customerId,
      subject: params.subject,
      status: params.status,
      priority: params.priority,
      type: params.type,
      channel: params.channel,
      direction: params.direction,
      providerId: params.providerId,
      metadata: params.metadata,
    });

  return {
    operation: 'create',
    conversationId: result.conversationId,
    success: result.success,
    timestamp: Date.now(),
  };
}


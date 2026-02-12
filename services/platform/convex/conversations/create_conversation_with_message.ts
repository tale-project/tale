/**
 * Create a new conversation with an initial message (business logic)
 *
 * This is an atomic operation that creates both a conversation and its first message.
 * Useful for email workflows and other scenarios where a conversation always starts with a message.
 */

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { CreateConversationArgs } from './types';

import * as AuditLogHelpers from '../audit_logs/helpers';
import { toConvexJsonRecord } from '../lib/type_cast_helpers';
import { createConversation } from './create_conversation';

export interface CreateConversationWithMessageArgs extends CreateConversationArgs {
  // Initial message fields
  initialMessage: {
    sender: string;
    content: string;
    isCustomer: boolean;
    status?: string;
    attachment?: unknown;
    externalMessageId?: string;
    metadata?: unknown;
    sentAt?: number; // Timestamp when message was sent (for outbound) or received (for inbound)
    deliveredAt?: number; // Timestamp when message was delivered (for email sync)
  };
}

export interface CreateConversationWithMessageResult {
  success: boolean;
  conversationId: Id<'conversations'>;
  messageId: Id<'conversationMessages'>;
}

/**
 * Create a conversation and add the initial message atomically.
 * Both operations succeed or fail together.
 */
export async function createConversationWithMessage(
  ctx: MutationCtx,
  args: CreateConversationWithMessageArgs,
): Promise<CreateConversationWithMessageResult> {
  // Create the conversation
  const conversationResult = await createConversation(ctx, args);
  const conversationId = conversationResult.conversationId;

  // Get the conversation to access its channel
  const conversation = await ctx.db.get(conversationId);
  if (!conversation) {
    throw new Error('Failed to retrieve created conversation');
  }

  // Determine message direction and delivery state
  const direction: 'inbound' | 'outbound' = args.initialMessage.isCustomer
    ? 'inbound'
    : 'outbound';

  const deliveryStateMap: Record<
    string,
    'queued' | 'sent' | 'delivered' | 'failed'
  > = {
    queued: 'queued',
    sent: 'sent',
    delivered: 'delivered',
    failed: 'failed',
  };

  const explicit = (args.initialMessage.status || '').toLowerCase();
  const deliveryState =
    deliveryStateMap[explicit] ??
    (direction === 'inbound' ? 'delivered' : 'sent');

  // Insert the initial message
  // Only set sentAt/deliveredAt if we have an actual timestamp
  const messageId = await ctx.db.insert('conversationMessages', {
    organizationId: args.organizationId,
    conversationId,
    channel: conversation.channel || 'unknown',
    direction,
    externalMessageId: args.initialMessage.externalMessageId,
    deliveryState,
    content: args.initialMessage.content,
    sentAt: args.initialMessage.sentAt ? args.initialMessage.sentAt : undefined,
    deliveredAt: args.initialMessage.deliveredAt
      ? args.initialMessage.deliveredAt
      : direction === 'inbound' && args.initialMessage.sentAt
        ? args.initialMessage.sentAt
        : undefined,

    metadata: toConvexJsonRecord({
      sender: args.initialMessage.sender,
      isCustomer: args.initialMessage.isCustomer,
      ...(args.initialMessage.attachment
        ? { attachment: args.initialMessage.attachment }
        : {}),
      ...(typeof args.initialMessage.metadata === 'object' &&
      args.initialMessage.metadata !== null &&
      !Array.isArray(args.initialMessage.metadata)
        ? args.initialMessage.metadata
        : {}),
    }),
  });

  // Update conversation with initial message info
  // Set both the indexed lastMessageAt field and metadata for backwards compatibility
  const now = Date.now();
  const existingMetadata = conversation.metadata ?? {};
  await ctx.db.patch(conversationId, {
    lastMessageAt: now,
    metadata: {
      ...existingMetadata,
      last_message_at: now,
      unread_count: args.initialMessage.isCustomer ? 1 : 0,
    },
  });

  await AuditLogHelpers.logSuccess(
    ctx,
    {
      organizationId: args.organizationId,
      actor: { id: 'system', type: 'system' as const },
    },
    'add_message_to_conversation',
    'data',
    'conversationMessage',
    String(messageId),
    undefined,
    undefined,
    {
      conversationId: String(conversationId),
      direction,
      isCustomer: args.initialMessage.isCustomer,
      sender: args.initialMessage.sender,
    },
  );

  return {
    success: true,
    conversationId,
    messageId,
  };
}

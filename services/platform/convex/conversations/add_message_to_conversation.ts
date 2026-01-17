/**
 * Add a message to a conversation (business logic)
 */

import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';

export async function addMessageToConversation(
  ctx: MutationCtx,
  args: {
    conversationId: Id<'conversations'>;
    organizationId: string;
    sender: string;
    content: string;
    isCustomer: boolean;
    status?: string;
    attachment?: unknown;
    providerId?: Id<'emailProviders'>; // Email provider ID (stored on conversation, not message)
    externalMessageId?: string;
    metadata?: unknown;
    sentAt?: number; // Timestamp when message was sent (for outbound) or received (for inbound)
    deliveredAt?: number; // Timestamp when message was delivered (for email sync)
  },
): Promise<Id<'conversations'>> {
  // Verify parent conversation exists
  const parentConversation = await ctx.db.get(args.conversationId);
  if (!parentConversation) {
    throw new Error('Parent conversation not found');
  }

  // Insert into conversationMessages instead of creating a child conversation row
  const direction: 'inbound' | 'outbound' = args.isCustomer
    ? 'inbound'
    : 'outbound';
  const deliveryStateCandidates = [
    'queued',
    'sent',
    'delivered',
    'failed',
  ] as const;
  const explicit = (args.status || '').toLowerCase();
  const deliveryState = (deliveryStateCandidates as readonly string[]).includes(
    explicit,
  )
    ? (explicit as 'queued' | 'sent' | 'delivered' | 'failed')
    : direction === 'inbound'
      ? 'delivered'
      : 'sent';

  // Only set sentAt/deliveredAt if we have an actual timestamp
  await ctx.db.insert('conversationMessages', {
    organizationId: args.organizationId,
    conversationId: args.conversationId,
    providerId: args.providerId || parentConversation.providerId, // Use provided or inherit from parent conversation
    channel: parentConversation.channel || 'unknown',
    direction,
    externalMessageId: args.externalMessageId,
    deliveryState,
    content: args.content,
    sentAt: args.sentAt ? args.sentAt : undefined,
    deliveredAt: args.deliveredAt
      ? args.deliveredAt
      : direction === 'inbound' && args.sentAt
        ? args.sentAt
        : undefined,
    metadata: {
      sender: args.sender,
      isCustomer: args.isCustomer,
      attachment: args.attachment,
      ...(args.metadata as Record<string, unknown> | undefined),
    },
  });

  // Update conversation's providerId if provided and not already set
  if (args.providerId && !parentConversation.providerId) {
    await ctx.db.patch(args.conversationId, {
      providerId: args.providerId,
    });
  }

  // Update parent conversation with last message info
  // Set both the indexed lastMessageAt field and metadata for backwards compatibility
  const now = Date.now();
  const existingMetadata =
    (parentConversation.metadata as Record<string, unknown>) || {};
  await ctx.db.patch(args.conversationId, {
    lastMessageAt: now,
    metadata: {
      ...existingMetadata,
      last_message_at: now,
      unread_count:
        ((existingMetadata.unread_count as number) || 0) +
        (args.isCustomer ? 1 : 0),
    },
  });

  // Maintain return type contract (conversation id)
  return args.conversationId;
}

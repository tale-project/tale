/**
 * Update a conversation message (business logic)
 */

import type { MutationCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';

export async function updateConversationMessage(
  ctx: MutationCtx,
  args: {
    messageId: Id<'conversationMessages'>;
    externalMessageId?: string;
    deliveryState?: 'queued' | 'sent' | 'delivered' | 'failed';
    sentAt?: number;
    deliveredAt?: number;
    metadata?: unknown;
    retryCount?: number;
  },
): Promise<void> {
  const message = await ctx.db.get(args.messageId);
  if (!message) {
    throw new Error('Conversation message not found');
  }

  // Build update object with only provided fields
  const updateData: Record<string, unknown> = {};
  if (args.externalMessageId !== undefined)
    updateData.externalMessageId = args.externalMessageId;
  if (args.deliveryState !== undefined)
    updateData.deliveryState = args.deliveryState;
  if (args.sentAt !== undefined) updateData.sentAt = args.sentAt;
  if (args.deliveredAt !== undefined)
    updateData.deliveredAt = args.deliveredAt;
  if (args.retryCount !== undefined) updateData.retryCount = args.retryCount;
  if (args.metadata !== undefined) {
    // Merge metadata to preserve existing fields
    const existingMetadata =
      (message.metadata as Record<string, unknown>) || {};
    updateData.metadata = {
      ...existingMetadata,
      ...(args.metadata as Record<string, unknown>),
    };
  }

  await ctx.db.patch(args.messageId, updateData);
}


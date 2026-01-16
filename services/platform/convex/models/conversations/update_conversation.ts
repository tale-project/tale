/**
 * Update a conversation (business logic)
 */

import type { MutationCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import type { ConversationStatus, ConversationPriority } from './types';

export async function updateConversation(
  ctx: MutationCtx,
  args: {
    conversationId: Id<'conversations'>;
    subject?: string;
    status?: ConversationStatus;
    priority?: ConversationPriority;
    type?: string;
    metadata?: unknown;
  },
): Promise<void> {
  const conversation = await ctx.db.get(args.conversationId);
  if (!conversation) {
    throw new Error('Conversation not found');
  }

  // Build update object with only provided fields
  const updateData: Record<string, unknown> = {};
  if (args.subject !== undefined) updateData.subject = args.subject;
  if (args.status !== undefined) updateData.status = args.status;
  if (args.priority !== undefined) updateData.priority = args.priority;
  if (args.type !== undefined) updateData.type = args.type;
  if (args.metadata !== undefined) {
    // Merge metadata to preserve existing fields
    const existingMetadata =
      (conversation.metadata as Record<string, unknown>) || {};
    updateData.metadata = {
      ...existingMetadata,
      ...(args.metadata as Record<string, unknown>),
    };
  }

  await ctx.db.patch(args.conversationId, updateData);
}

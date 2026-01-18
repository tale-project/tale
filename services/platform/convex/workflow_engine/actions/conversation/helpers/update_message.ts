import type { ActionCtx } from '../../../../_generated/server';
import { internal } from '../../../../_generated/api';
import type { Id } from '../../../../_generated/dataModel';
import type { EmailType } from './types';
import { buildEmailMetadata } from './build_email_metadata';

/**
 * Update an existing message with delivered state and metadata
 */
export async function updateMessage(
  ctx: ActionCtx,
  messageId: Id<'conversationMessages'>,
  email: EmailType,
) {
  const emailTimestamp = new Date(email.date).getTime();

  await ctx.runMutation(
    internal.conversations.mutations.updateConversationMessageInternal,
    {
      messageId,
      deliveryState: 'delivered',
      deliveredAt: emailTimestamp,
      metadata: buildEmailMetadata(email),
    },
  );
}

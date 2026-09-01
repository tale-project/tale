import type { ActionCtx } from '../../lib/ctx';
import { internal } from '../../lib/handler_names';
import type { Id } from '../../lib/rows';
import { buildEmailMetadata } from './build_email_metadata';
import type { EmailType } from './types';

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
    internal.conversations.internal_mutations.updateConversationMessage,
    {
      messageId,
      deliveryState: 'delivered',
      deliveredAt: emailTimestamp,
      metadata: buildEmailMetadata(email),
    },
  );
}

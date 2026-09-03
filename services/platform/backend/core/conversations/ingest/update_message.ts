import type { ActionCtx } from '../../lib/ctx';
import { internal } from '../../lib/handler_names';
import type { Id } from '../../lib/rows';
import { buildEmailMetadata } from './build_email_metadata';
import { emailEpochMs } from './email_epoch';
import type { EmailType } from './types';

/**
 * Update an existing message with delivered state and metadata. A message
 * with no readable date keeps the `deliveredAt` it has rather than being
 * stamped NaN (which the mutation would reject, wedging the pass).
 */
export async function updateMessage(
  ctx: ActionCtx,
  messageId: Id<'conversationMessages'>,
  email: EmailType,
) {
  const deliveredAt = emailEpochMs(email.date);

  await ctx.runMutation(
    internal.conversations.internal_mutations.updateConversationMessage,
    {
      messageId,
      deliveryState: 'delivered',
      ...(deliveredAt !== null ? { deliveredAt } : {}),
      metadata: buildEmailMetadata(email),
    },
  );
}

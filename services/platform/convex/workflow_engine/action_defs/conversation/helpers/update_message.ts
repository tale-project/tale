import type { Id } from '../../../../_generated/dataModel';
import type { ActionCtx } from '../../../../_generated/server';
import type { EmailType } from './types';

import { internal } from '../../../../_generated/api';
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
    internal.conversations.internal_mutations.updateConversationMessage,
    {
      messageId,
      deliveryState: 'delivered',
      deliveredAt: emailTimestamp,
      metadata: buildEmailMetadata(email),
    },
  );
}

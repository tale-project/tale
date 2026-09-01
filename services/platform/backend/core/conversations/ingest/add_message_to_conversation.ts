import type { ActionCtx } from '../../lib/ctx';
import { internal } from '../../lib/handler_names';
import type { Id } from '../../lib/rows';
import { attachmentsForMetadata } from './attachments_for_metadata';
import { buildEmailMetadata } from './build_email_metadata';
import { normalizeExternalMessageId } from './normalize_external_message_id';
import type { EmailType } from './types';

/**
 * Add a message to an existing conversation
 */
export async function addMessageToConversation(
  ctx: ActionCtx,
  conversationId: Id<'conversations'>,
  organizationId: string,
  email: EmailType,
  isCustomer: boolean,
  status: 'delivered' | 'sent',
  connectorName?: string,
) {
  const emailTimestamp = new Date(email.date).getTime();
  const attachments = attachmentsForMetadata(email.attachments);

  await ctx.runMutation(
    internal.conversations.internal_mutations.addMessageToConversation,
    {
      conversationId,
      organizationId,
      sender: email.from?.[0]?.address || email.from?.[0]?.name || 'unknown',
      content: email.html || email.text || '',
      isCustomer,
      status,
      externalMessageId: normalizeExternalMessageId(email.messageId),
      metadata: buildEmailMetadata(email),
      sentAt: emailTimestamp,
      deliveredAt: status === 'delivered' ? emailTimestamp : undefined,
      ...(attachments?.length ? { attachments } : {}),
      ...(connectorName ? { connectorName } : {}),
    },
  );
}

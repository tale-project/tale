import type { ActionCtx } from '../../lib/ctx';
import { internal } from '../../lib/handler_names';
import type { Id } from '../../lib/rows';
import type { EmailType } from './types';

/**
 * Find or create a contact based on email direction (issue #2618). The contact
 * is the conversation correspondent — the sender on inbound mail, the recipient
 * on outbound.
 */
export async function findOrCreateContactFromEmail(
  ctx: ActionCtx,
  organizationId: string,
  email: EmailType,
  direction: 'inbound' | 'outbound',
): Promise<{ contactId: Id<'contacts'>; email: string } | null> {
  // For inbound: contact is the sender (from)
  // For outbound: contact is the recipient (to)
  const contactEmail =
    direction === 'inbound' ? email.from?.[0]?.address : email.to?.[0]?.address;

  if (!contactEmail) {
    return null;
  }

  const contactName =
    direction === 'inbound'
      ? email.from?.[0]?.name || contactEmail
      : email.to?.[0]?.name || contactEmail;

  const result = await ctx.runMutation(
    internal.contacts.internal_mutations.findOrCreateContact,
    {
      organizationId,
      email: contactEmail,
      name: contactName,
      source: 'conversation',
      metadata: {
        createdFrom: direction === 'inbound' ? 'email_sync' : 'sent_email_sync',
        firstEmailDate: email.date,
      },
    },
  );

  return {
    contactId: result.contactId,
    email: contactEmail,
  };
}

import type { ActionCtx } from '../../../../_generated/server';
import { internal } from '../../../../_generated/api';
import type { Id } from '../../../../_generated/dataModel';
import type { EmailType } from './types';

/**
 * Find or create customer based on email direction
 */
export async function findOrCreateCustomerFromEmail(
  ctx: ActionCtx,
  organizationId: string,
  email: EmailType,
  direction: 'inbound' | 'outbound',
): Promise<{ customerId: Id<'customers'>; email: string } | null> {
  // For inbound: customer is the sender (from)
  // For outbound: customer is the recipient (to)
  const customerEmail =
    direction === 'inbound' ? email.from?.[0]?.address : email.to?.[0]?.address;

  if (!customerEmail) {
    return null;
  }

  const customerName =
    direction === 'inbound'
      ? email.from?.[0]?.name || customerEmail
      : email.to?.[0]?.name || customerEmail;

  const result = await ctx.runMutation(
    internal.customers.findOrCreateCustomer,
    {
      organizationId,
      email: customerEmail,
      name: customerName,
      source: 'manual_import',
      status: 'potential',
      metadata: {
        createdFrom: direction === 'inbound' ? 'email_sync' : 'sent_email_sync',
        firstEmailDate: email.date,
      },
    },
  );

  return {
    customerId: result.customerId,
    email: customerEmail,
  };
}

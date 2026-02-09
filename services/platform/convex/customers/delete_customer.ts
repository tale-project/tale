/**
 * Delete a customer (business logic)
 */

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

import { emitEvent } from '../workflows/triggers/emit_event';

export async function deleteCustomer(
  ctx: MutationCtx,
  customerId: Id<'customers'>,
): Promise<null> {
  const customer = await ctx.db.get(customerId);
  if (!customer) {
    throw new Error('Customer not found');
  }

  await emitEvent(ctx, {
    organizationId: customer.organizationId,
    eventType: 'customer.deleted',
    eventData: {
      customerId,
      name: customer.name,
      email: customer.email,
    },
  });

  await ctx.db.delete(customerId);
  return null;
}

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
    eventData: { customer },
  });

  await ctx.db.delete(customerId);
  return null;
}

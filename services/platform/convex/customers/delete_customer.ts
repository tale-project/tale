/**
 * Delete a customer (business logic)
 */

import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';

export async function deleteCustomer(
  ctx: MutationCtx,
  customerId: Id<'customers'>,
): Promise<{ success: boolean }> {
  const customer = await ctx.db.get(customerId);
  if (!customer) {
    throw new Error('Customer not found');
  }

  await ctx.db.delete(customerId);
  return { success: true };
}


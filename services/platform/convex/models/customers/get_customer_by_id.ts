/**
 * Get a customer by ID (business logic)
 */

import type { QueryCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';

export async function getCustomerById(
  ctx: QueryCtx,
  customerId: Id<'customers'>,
) {
  return await ctx.db.get(customerId);
}

/**
 * Get a customer by ID (business logic)
 */

import type { Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

export async function getCustomerById(
  ctx: QueryCtx,
  customerId: Id<'customers'>,
) {
  return await ctx.db.get(customerId);
}

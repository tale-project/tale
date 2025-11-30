/**
 * Get a single customer by ID (business logic)
 */

import type { QueryCtx } from '../../_generated/server';
import type { Doc, Id } from '../../_generated/dataModel';

export async function getCustomer(
  ctx: QueryCtx,
  customerId: Id<'customers'>,
): Promise<Doc<'customers'> | null> {
  return await ctx.db.get(customerId);
}


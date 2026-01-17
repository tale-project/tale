/**
 * Get a customer by email within an organization (business logic)
 */

import type { QueryCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';

export async function getCustomerByEmail(
  ctx: QueryCtx,
  organizationId: string,
  email: string,
): Promise<Doc<'customers'> | null> {
  return await ctx.db
    .query('customers')
    .withIndex('by_organizationId_and_email', (q) =>
      q.eq('organizationId', organizationId).eq('email', email),
    )
    .first();
}

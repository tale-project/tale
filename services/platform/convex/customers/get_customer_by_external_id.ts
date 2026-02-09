/**
 * Get a customer by external ID within an organization (business logic)
 */

import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

export async function getCustomerByExternalId(
  ctx: QueryCtx,
  organizationId: string,
  externalId: string,
): Promise<Doc<'customers'> | null> {
  return await ctx.db
    .query('customers')
    .withIndex('by_organizationId_and_externalId', (q) =>
      q.eq('organizationId', organizationId).eq('externalId', externalId),
    )
    .first();
}

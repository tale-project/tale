/**
 * Search customers by name, email, or external ID (business logic)
 */

import type { QueryCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';

export async function searchCustomers(
  ctx: QueryCtx,
  organizationId: string,
  searchTerm: string,
  limit?: number,
): Promise<Array<Doc<'customers'>>> {
  const customers = await ctx.db
    .query('customers')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', organizationId),
    )
    .collect();

  const searchLower = searchTerm.toLowerCase();
  const filtered = customers.filter((customer) => {
    const nameMatch = customer.name?.toLowerCase().includes(searchLower);
    const emailMatch = customer.email?.toLowerCase().includes(searchLower);
    const externalIdMatch = customer.externalId
      ? String(customer.externalId).toLowerCase().includes(searchLower)
      : false;
    return nameMatch || emailMatch || externalIdMatch;
  });

  // Sort by relevance (exact matches first, then partial matches)
  filtered.sort((a, b) => {
    const aExact = a.name === searchTerm || a.email === searchTerm;
    const bExact = b.name === searchTerm || b.email === searchTerm;

    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;

    return b._creationTime - a._creationTime;
  });

  const resultLimit = limit || 50;
  return filtered.slice(0, resultLimit);
}

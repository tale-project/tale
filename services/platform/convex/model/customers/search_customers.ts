/**
 * Search customers by name, email, or external ID (business logic)
 *
 * Uses async iteration for memory efficiency with large datasets.
 * Note: Full-text search would be more efficient for this use case,
 * but requires a search index on the customers table.
 */

import type { QueryCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';

export async function searchCustomers(
  ctx: QueryCtx,
  organizationId: string,
  searchTerm: string,
  limit?: number,
): Promise<Array<Doc<'customers'>>> {
  const searchLower = searchTerm.toLowerCase();
  const resultLimit = limit || 50;

  // Use async iteration for memory efficiency
  const query = ctx.db
    .query('customers')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', organizationId),
    );

  const filtered: Array<Doc<'customers'>> = [];

  for await (const customer of query) {
    const nameMatch = customer.name?.toLowerCase().includes(searchLower);
    const emailMatch = customer.email?.toLowerCase().includes(searchLower);
    const externalIdMatch = customer.externalId
      ? String(customer.externalId).toLowerCase().includes(searchLower)
      : false;

    if (nameMatch || emailMatch || externalIdMatch) {
      filtered.push(customer);
    }
  }

  // Sort by relevance (exact matches first, then partial matches)
  filtered.sort((a, b) => {
    const aExact = a.name === searchTerm || a.email === searchTerm;
    const bExact = b.name === searchTerm || b.email === searchTerm;

    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;

    return b._creationTime - a._creationTime;
  });

  return filtered.slice(0, resultLimit);
}

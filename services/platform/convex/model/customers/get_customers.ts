/**
 * Get a paginated list of customers for an organization (business logic)
 */

import type { QueryCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';

export interface GetCustomersArgs {
  organizationId: string;
  paginationOpts: {
    numItems: number;
    cursor: string | null;
  };
  status?: Array<'active' | 'churned' | 'potential'>;
  source?: string[];
  searchTerm?: string;
  locale?: string[];
}

export interface GetCustomersResult {
  page: Array<Doc<'customers'>>;
  isDone: boolean;
  continueCursor?: string;
}

export async function getCustomers(
  ctx: QueryCtx,
  args: GetCustomersArgs,
): Promise<GetCustomersResult> {
  // Start with all customers in the organization
  let customers = await ctx.db
    .query('customers')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    )
    .collect();

  // Apply status filter if provided
  if (args.status && args.status.length > 0) {
    customers = customers.filter(
      (c) => c.status && args.status!.includes(c.status),
    );
  }

  // Apply source filter if provided
  if (args.source && args.source.length > 0) {
    customers = customers.filter(
      (c) => c.source && args.source!.includes(c.source),
    );
  }

  // Apply locale filter if provided
  if (args.locale && args.locale.length > 0) {
    customers = customers.filter(
      (c) => c.locale && args.locale!.includes(c.locale),
    );
  }

  // Apply search filter if provided
  if (args.searchTerm) {
    const searchLower = args.searchTerm.toLowerCase();
    customers = customers.filter((customer) => {
      const nameMatch = customer.name?.toLowerCase().includes(searchLower);
      const emailMatch = customer.email?.toLowerCase().includes(searchLower);
      const externalIdMatch = customer.externalId
        ? String(customer.externalId).toLowerCase().includes(searchLower)
        : false;
      return nameMatch || emailMatch || externalIdMatch;
    });
  }

  // Sort by creation time (newest first)
  customers.sort((a, b) => b._creationTime - a._creationTime);

  // Apply pagination
  const startIndex = args.paginationOpts.cursor
    ? customers.findIndex((c) => c._id === args.paginationOpts.cursor) + 1
    : 0;
  const endIndex = startIndex + args.paginationOpts.numItems;
  const paginatedCustomers = customers.slice(startIndex, endIndex);

  return {
    page: paginatedCustomers,
    isDone: endIndex >= customers.length,
    continueCursor:
      paginatedCustomers.length > 0
        ? paginatedCustomers[paginatedCustomers.length - 1]._id
        : undefined,
  };
}

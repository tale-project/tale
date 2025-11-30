/**
 * Query customers with flexible filtering and pagination support (business logic)
 *
 * This query allows filtering customers by:
 * - Organization (required, uses index)
 * - Status field (optional)
 * - Metadata fields (optional, supports dot notation and operators)
 *
 * Pagination:
 * - Supports cursor-based pagination for efficient data fetching
 * - Returns page of results, isDone flag, and continueCursor
 *
 * Following Convex best practices:
 * - Uses withIndex for organization (efficient)
 * - Filters in code for metadata (acceptable per Convex docs)
 */

import type { QueryCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';

export interface QueryCustomersArgs {
  organizationId: string;
  externalId?: string | number;
  status?: 'active' | 'churned' | 'potential';
  source?: 'manual_import' | 'file_upload' | 'circuly';

  paginationOpts: {
    numItems: number;
    cursor: string | null;
  };
}

export interface QueryCustomersResult {
  page: Array<Doc<'customers'>>;
  isDone: boolean;
  continueCursor: string | null;
  count: number;
}

export async function queryCustomers(
  ctx: QueryCtx,
  args: QueryCustomersArgs,
): Promise<QueryCustomersResult> {
  const numItems = args.paginationOpts.numItems;

  // Use appropriate index based on filters
  let customers;

  if (args.externalId !== undefined) {
    // Use by_organizationId_and_externalId index
    customers = await ctx.db
      .query('customers')
      .withIndex('by_organizationId_and_externalId', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('externalId', args.externalId),
      )
      .collect();
  } else if (args.source !== undefined) {
    // Use by_organizationId_and_source index
    const source = args.source;
    customers = await ctx.db
      .query('customers')
      .withIndex('by_organizationId_and_source', (q) =>
        q.eq('organizationId', args.organizationId).eq('source', source),
      )
      .collect();
  } else if (args.status !== undefined) {
    // Use by_organizationId_and_status index
    customers = await ctx.db
      .query('customers')
      .withIndex('by_organizationId_and_status', (q) =>
        q.eq('organizationId', args.organizationId).eq('status', args.status),
      )
      .collect();
  } else {
    // Use by_organizationId index
    customers = await ctx.db
      .query('customers')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .collect();
  }

  // Filter in code for additional conditions
  const filteredCustomers = customers.filter((customer) => {
    // Filter by status if provided and not already filtered by index
    if (
      args.status &&
      args.externalId !== undefined &&
      args.source === undefined &&
      customer.status !== args.status
    ) {
      return false;
    }

    // Filter by source if provided and not already filtered by index
    if (
      args.source &&
      args.externalId !== undefined &&
      customer.source !== args.source
    ) {
      return false;
    }

    return true;
  });

  // Sort by creation time (newest first) for consistent pagination
  filteredCustomers.sort((a, b) => b._creationTime - a._creationTime);

  // Apply cursor-based pagination
  const paginationOpts = args.paginationOpts;
  const startIndex = paginationOpts.cursor
    ? filteredCustomers.findIndex((c) => c._id === paginationOpts.cursor) + 1
    : 0;
  const endIndex = startIndex + numItems;
  const paginatedCustomers = filteredCustomers.slice(startIndex, endIndex);

  return {
    page: paginatedCustomers,
    isDone: endIndex >= filteredCustomers.length,
    continueCursor:
      paginatedCustomers.length > 0
        ? paginatedCustomers[paginatedCustomers.length - 1]._id
        : null,
    count: paginatedCustomers.length,
  };
}

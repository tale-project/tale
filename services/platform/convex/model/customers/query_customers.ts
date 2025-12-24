/**
 * Query customers with flexible filtering and pagination support (business logic)
 *
 * Uses cursor-based pagination optimized for infinite scroll / load more patterns.
 * Filters are applied in memory after index narrowing for flexibility.
 */

import type { QueryCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';
import { paginateWithFilter, type CursorPaginatedResult } from '../../lib/pagination';

type CustomerStatus = 'active' | 'churned' | 'potential';
type CustomerSource = 'manual_import' | 'file_upload' | 'circuly';

export interface QueryCustomersArgs {
  organizationId: string;
  externalId?: string | number;
  status?: CustomerStatus | CustomerStatus[];
  source?: CustomerSource | string[];
  locale?: string[];
  searchTerm?: string;
  paginationOpts: {
    numItems: number;
    cursor: string | null;
  };
}

export async function queryCustomers(
  ctx: QueryCtx,
  args: QueryCustomersArgs,
): Promise<CursorPaginatedResult<Doc<'customers'>>> {
  // Build the base query with index
  const query = ctx.db
    .query('customers')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    )
    .order('desc');

  // Pre-compute filter sets for O(1) lookups
  const statusSet = args.status
    ? new Set(Array.isArray(args.status) ? args.status : [args.status])
    : null;
  const sourceSet = args.source
    ? new Set(Array.isArray(args.source) ? args.source : [args.source])
    : null;
  const localeSet =
    args.locale && args.locale.length > 0 ? new Set(args.locale) : null;
  const searchLower = args.searchTerm?.toLowerCase();

  // Create filter function
  const filter = (customer: Doc<'customers'>): boolean => {
    // ExternalId filter
    if (args.externalId !== undefined && customer.externalId !== args.externalId) {
      return false;
    }

    // Status filter
    if (statusSet && statusSet.size > 0) {
      if (!customer.status || !statusSet.has(customer.status)) {
        return false;
      }
    }

    // Source filter
    if (sourceSet && sourceSet.size > 0) {
      if (!customer.source || !sourceSet.has(customer.source)) {
        return false;
      }
    }

    // Locale filter
    if (localeSet) {
      if (!customer.locale || !localeSet.has(customer.locale)) {
        return false;
      }
    }

    // Search term filter
    if (searchLower) {
      const nameMatch = customer.name?.toLowerCase().includes(searchLower);
      const emailMatch = customer.email?.toLowerCase().includes(searchLower);
      const externalIdMatch = customer.externalId
        ? String(customer.externalId).toLowerCase().includes(searchLower)
        : false;
      if (!nameMatch && !emailMatch && !externalIdMatch) {
        return false;
      }
    }

    return true;
  };

  // Use optimized pagination helper
  return paginateWithFilter(query, {
    numItems: args.paginationOpts.numItems,
    cursor: args.paginationOpts.cursor,
    filter,
  });
}

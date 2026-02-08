/**
 * Query customers with flexible filtering and pagination support (business logic)
 *
 * Uses cursor-based pagination optimized for infinite scroll / load more patterns.
 * Selects the most specific index based on provided filters, then applies
 * remaining filters in memory via paginateWithFilter.
 */

import type { QueryCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { paginateWithFilter, type CursorPaginatedResult } from '../lib/pagination';
import type { CustomerStatus, CustomerSource } from './types';

export interface QueryCustomersArgs {
  organizationId: string;
  externalId?: string | number;
  status?: CustomerStatus | CustomerStatus[];
  source?: CustomerSource | CustomerSource[];
  locale?: string[];
  searchTerm?: string;
  paginationOpts: {
    numItems: number;
    cursor: string | null;
  };
}

function buildQuery(ctx: QueryCtx, args: QueryCustomersArgs) {
  const { organizationId } = args;

  return {
    query: ctx.db
      .query('customers')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', organizationId),
      )
      .order('desc'),
    indexedFields: {} as const,
  };
}

export async function queryCustomers(
  ctx: QueryCtx,
  args: QueryCustomersArgs,
): Promise<CursorPaginatedResult<Doc<'customers'>>> {
  const { query, indexedFields } = buildQuery(ctx, args);

  // Pre-compute filter sets for O(1) lookups (only for non-indexed fields)
  const statusSet =
    !('status' in indexedFields) && args.status
      ? new Set(Array.isArray(args.status) ? args.status : [args.status])
      : null;
  const sourceSet =
    !('source' in indexedFields) && args.source
      ? new Set(Array.isArray(args.source) ? args.source : [args.source])
      : null;
  const localeSet =
    !('locale' in indexedFields) && args.locale && args.locale.length > 0
      ? new Set(args.locale)
      : null;
  const needsExternalIdFilter =
    !('externalId' in indexedFields) && args.externalId !== undefined;
  const searchLower = args.searchTerm?.toLowerCase();

  const needsFilter =
    statusSet || sourceSet || localeSet || needsExternalIdFilter || searchLower;

  const filter = needsFilter
    ? (customer: Doc<'customers'>): boolean => {
        if (needsExternalIdFilter && customer.externalId !== args.externalId) {
          return false;
        }

        if (statusSet && statusSet.size > 0) {
          if (!customer.status || !statusSet.has(customer.status)) {
            return false;
          }
        }

        if (sourceSet && sourceSet.size > 0) {
          if (!customer.source || !sourceSet.has(customer.source)) {
            return false;
          }
        }

        if (localeSet) {
          if (!customer.locale || !localeSet.has(customer.locale)) {
            return false;
          }
        }

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
      }
    : undefined;

  return paginateWithFilter(query, {
    numItems: args.paginationOpts.numItems,
    cursor: args.paginationOpts.cursor,
    filter,
  });
}

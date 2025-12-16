/**
 * Query customers with flexible filtering and pagination support (business logic)
 *
 * This query allows filtering customers by:
 * - Organization (required, uses index)
 * - Status field (optional, single value or array)
 * - Source field (optional, single value or array)
 * - Locale field (optional, array)
 * - ExternalId field (optional)
 * - Search term (optional, searches name/email/externalId)
 *
 * Pagination:
 * - Supports cursor-based pagination for efficient data fetching
 * - Returns page of results, isDone flag, and continueCursor
 *
 * Following Convex best practices:
 * - Uses withIndex for organization (efficient)
 * - Filters in code for other fields (acceptable per Convex docs)
 */

import type { QueryCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';

type CustomerStatus = 'active' | 'churned' | 'potential';
type CustomerSource = 'manual_import' | 'file_upload' | 'circuly';

export interface QueryCustomersArgs {
  organizationId: string;
  externalId?: string | number;
  status?: CustomerStatus | CustomerStatus[];
  source?: CustomerSource | string[];
  locale?: string[];
  searchTerm?: string;
  fields?: string[];

  paginationOpts: {
    numItems: number;
    cursor: string | null;
  };
}

export interface QueryCustomersResult {
  items: Array<Doc<'customers'>> | Array<Record<string, unknown>>;
  isDone: boolean;
  continueCursor: string | null;
  count: number;
}

export async function queryCustomers(
  ctx: QueryCtx,
  args: QueryCustomersArgs,
): Promise<QueryCustomersResult> {
  const numItems = args.paginationOpts.numItems;
  const cursor = args.paginationOpts.cursor;

  // Use by_organizationId index and filter in the loop
  const query = ctx.db
    .query('customers')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    )
    .order('desc');

  // Use async iteration to get only numItems customers
  const customers: Array<Doc<'customers'>> = [];
  let foundCursor = cursor === null;
  let hasMore = false;

  for await (const customer of query) {
    // Skip until we find the cursor
    if (!foundCursor) {
      if (customer._id === cursor) {
        foundCursor = true;
      }
      continue;
    }

    // Apply filters
    if (
      args.externalId !== undefined &&
      customer.externalId !== args.externalId
    ) {
      continue;
    }

    // Source filter (single value or array)
    if (args.source !== undefined) {
      const sources = Array.isArray(args.source) ? args.source : [args.source];
      if (
        sources.length > 0 &&
        (!customer.source || !sources.includes(customer.source))
      ) {
        continue;
      }
    }

    // Status filter (single value or array)
    if (args.status !== undefined) {
      const statuses = Array.isArray(args.status) ? args.status : [args.status];
      if (
        statuses.length > 0 &&
        (!customer.status || !statuses.includes(customer.status))
      ) {
        continue;
      }
    }

    // Locale filter (array)
    if (args.locale && args.locale.length > 0) {
      if (!customer.locale || !args.locale.includes(customer.locale)) {
        continue;
      }
    }

    // Search term filter (searches name, email, externalId)
    if (args.searchTerm) {
      const searchLower = args.searchTerm.toLowerCase();
      const nameMatch = customer.name?.toLowerCase().includes(searchLower);
      const emailMatch = customer.email?.toLowerCase().includes(searchLower);
      const externalIdMatch = customer.externalId
        ? String(customer.externalId).toLowerCase().includes(searchLower)
        : false;
      if (!nameMatch && !emailMatch && !externalIdMatch) {
        continue;
      }
    }

    customers.push(customer);

    // Check if we have enough items
    if (customers.length >= numItems) {
      hasMore = true;
      break;
    }
  }

  // Apply field projection if specified
  if (args.fields && args.fields.length > 0) {
    const projectedPage = customers.map((customer) => {
      const projected: Record<string, unknown> = {};
      for (const field of args.fields!) {
        if (field in customer) {
          projected[field] = customer[field as keyof typeof customer];
        }
      }
      return projected;
    });

    return {
      items: projectedPage,
      isDone: !hasMore,
      continueCursor:
        customers.length > 0 ? customers[customers.length - 1]._id : null,
      count: customers.length,
    };
  }

  return {
    items: customers,
    isDone: !hasMore,
    continueCursor:
      customers.length > 0 ? customers[customers.length - 1]._id : null,
    count: customers.length,
  };
}

/**
 * Get customers with offset-based pagination, search, and filtering
 *
 * Uses the unified query builder for smart index selection and
 * offset-based pagination for traditional page navigation.
 */

import type { QueryCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';
import {
  buildOffsetPaginatedQuery,
  type IndexConfig,
  type OffsetPaginatedResult,
} from '../../lib/query_builder';
import type { CustomerSource } from './types';

type CustomerStatus = 'active' | 'churned' | 'potential' | 'lost';

interface GetCustomersArgs {
  organizationId: string;
  currentPage?: number;
  pageSize?: number;
  searchTerm?: string;
  status?: CustomerStatus[];
  source?: CustomerSource[] | string[];
  locale?: string[];
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
}

// Available indexes for customers table
const CUSTOMER_INDEXES: IndexConfig[] = [
  { name: 'by_organizationId', fields: ['organizationId'], priority: 0 },
  {
    name: 'by_organizationId_and_status',
    fields: ['organizationId', 'status'],
    priority: 1,
  },
  {
    name: 'by_organizationId_and_sourceProvider',
    fields: ['organizationId', 'sourceProvider'],
    priority: 1,
  },
];

export async function getCustomers(
  ctx: QueryCtx,
  args: GetCustomersArgs,
): Promise<OffsetPaginatedResult<Doc<'customers'>>> {
  const {
    organizationId,
    currentPage = 1,
    pageSize = 10,
    searchTerm,
    status,
    source,
    locale,
    sortField = '_creationTime',
    sortOrder = 'desc',
  } = args;

  // Build filters object
  const filters: Record<string, unknown> = {};

  // Note: Arrays are handled by in-memory filtering, single values by index
  if (status && status.length === 1) {
    filters.status = status[0];
  } else if (status && status.length > 1) {
    filters.status = status;
  }

  if (source && source.length === 1) {
    filters.source = source[0];
  } else if (source && source.length > 1) {
    filters.source = source;
  }

  if (locale && locale.length > 0) {
    filters.locale = locale;
  }

  return buildOffsetPaginatedQuery<Doc<'customers'>>({
    ctx,
    table: 'customers',
    organizationId,
    indexes: CUSTOMER_INDEXES,
    filters,
    search: searchTerm
      ? {
          fields: ['name', 'email', 'externalId'],
          term: searchTerm,
        }
      : undefined,
    sort: {
      field: sortField,
      order: sortOrder,
    },
    pagination: {
      page: currentPage,
      pageSize,
    },
  });
}

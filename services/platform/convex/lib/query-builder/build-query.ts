/**
 * Unified query builder for Convex with smart index selection
 *
 * Provides optimized pagination and filtering using:
 * 1. Smart index selection based on available filters
 * 2. In-memory filtering for fields not covered by indexes
 * 3. Support for both offset and cursor-based pagination
 */

import type { GenericDocument } from 'convex/server';
import type { QueryCtx } from '../../_generated/server';
import {
  selectOptimalIndex,
  createInMemoryFilter,
  createSearchFilter,
  combineFilters,
} from './select-index';
import type {
  IndexConfig,
  QueryFilters,
  SearchConfig,
  SortConfig,
  OffsetPaginationOptions,
  CursorPaginationOptions,
  OffsetPaginatedResult,
  CursorPaginatedResult,
} from './types';

/**
 * Options for building a paginated query
 */
export interface BuildPaginatedQueryOptions<T extends GenericDocument> {
  /** Convex query context */
  ctx: QueryCtx;
  /** Table name to query */
  table: string;
  /** Organization ID (required for multi-tenant queries) */
  organizationId: string;
  /** Available indexes for this table */
  indexes: IndexConfig[];
  /** Filter values (field -> value mapping) */
  filters?: QueryFilters;
  /** Text search configuration */
  search?: SearchConfig;
  /** Sort configuration (defaults to _creationTime desc) */
  sort?: SortConfig;
  /** Custom filter function for complex filtering logic */
  customFilter?: (item: T) => boolean;
}

/**
 * Build an offset-paginated query with smart index selection
 *
 * Use this for traditional page navigation with total counts.
 * Note: This collects all matching items to calculate total count.
 *
 * @example
 * ```ts
 * const result = await buildOffsetPaginatedQuery({
 *   ctx,
 *   table: 'customers',
 *   organizationId: 'org123',
 *   indexes: [
 *     { name: 'by_organizationId', fields: ['organizationId'] },
 *     { name: 'by_organizationId_and_status', fields: ['organizationId', 'status'] },
 *   ],
 *   filters: { status: ['active', 'churned'] },
 *   search: { fields: ['name', 'email'], term: 'john' },
 *   pagination: { page: 1, pageSize: 10 },
 * });
 * ```
 */
export async function buildOffsetPaginatedQuery<T extends GenericDocument>(
  options: BuildPaginatedQueryOptions<T> & {
    pagination: OffsetPaginationOptions;
  },
): Promise<OffsetPaginatedResult<T>> {
  const {
    ctx,
    table,
    organizationId,
    indexes,
    filters = {},
    search,
    sort,
    customFilter,
    pagination,
  } = options;

  // Always include organizationId in filters
  const allFilters: QueryFilters = {
    organizationId,
    ...filters,
  };

  // Select optimal index
  const { indexName, indexedFields, remainingFilters } = selectOptimalIndex(
    indexes,
    allFilters,
  );

  // Build base query with selected index
  let query = (ctx.db as any).query(table);

  // Apply index conditions
  query = query.withIndex(indexName, (q: any) => {
    let builder = q;
    for (const field of indexedFields) {
      const value = allFilters[field];
      builder = builder.eq(field, value);
    }
    return builder;
  });

  // Apply sort order
  const sortOrder = sort?.order ?? 'desc';
  query = query.order(sortOrder);

  // Build combined filter function
  const filterFunctions: Array<(item: T) => boolean> = [];

  // Add in-memory filter for remaining fields
  if (remainingFilters.length > 0) {
    filterFunctions.push(createInMemoryFilter(allFilters, remainingFilters));
  }

  // Add search filter
  if (search && search.term) {
    filterFunctions.push(createSearchFilter(search.term, search.fields));
  }

  // Add custom filter
  if (customFilter) {
    filterFunctions.push(customFilter);
  }

  const combinedFilter =
    filterFunctions.length > 0 ? combineFilters(...filterFunctions) : () => true;

  // Collect all matching items (needed for total count)
  const matchingItems: T[] = [];
  for await (const item of query) {
    if (combinedFilter(item as T)) {
      matchingItems.push(item as T);
    }
  }

  // Apply custom sort if different from index sort
  if (sort && sort.field !== '_creationTime') {
    matchingItems.sort((a, b) => {
      const aValue = (a as any)[sort.field];
      const bValue = (b as any)[sort.field];
      const multiplier = sort.order === 'asc' ? 1 : -1;
      if (aValue > bValue) return multiplier;
      if (aValue < bValue) return -multiplier;
      return 0;
    });
  }

  // Calculate pagination
  const total = matchingItems.length;
  const { page, pageSize } = pagination;
  const totalPages = Math.ceil(total / pageSize);
  const startIndex = (page - 1) * pageSize;
  const paginatedItems = matchingItems.slice(startIndex, startIndex + pageSize);

  return {
    items: paginatedItems,
    total,
    page,
    pageSize,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}

/**
 * Build a cursor-paginated query with smart index selection
 *
 * Use this for infinite scroll / load more patterns.
 * More efficient than offset pagination for large datasets.
 *
 * @example
 * ```ts
 * const result = await buildCursorPaginatedQuery({
 *   ctx,
 *   table: 'customers',
 *   organizationId: 'org123',
 *   indexes: [...],
 *   filters: { status: 'active' },
 *   pagination: { numItems: 20, cursor: null },
 * });
 * ```
 */
export async function buildCursorPaginatedQuery<T extends GenericDocument>(
  options: BuildPaginatedQueryOptions<T> & {
    pagination: CursorPaginationOptions;
  },
): Promise<CursorPaginatedResult<T>> {
  const {
    ctx,
    table,
    organizationId,
    indexes,
    filters = {},
    search,
    customFilter,
    pagination,
  } = options;

  // Always include organizationId in filters
  const allFilters: QueryFilters = {
    organizationId,
    ...filters,
  };

  // Select optimal index
  const { indexName, indexedFields, remainingFilters } = selectOptimalIndex(
    indexes,
    allFilters,
  );

  // Build base query with selected index
  let query = (ctx.db as any).query(table);

  // Apply index conditions
  query = query.withIndex(indexName, (q: any) => {
    let builder = q;
    for (const field of indexedFields) {
      const value = allFilters[field];
      builder = builder.eq(field, value);
    }
    return builder;
  });

  query = query.order('desc');

  // Build combined filter function
  const filterFunctions: Array<(item: T) => boolean> = [];

  if (remainingFilters.length > 0) {
    filterFunctions.push(createInMemoryFilter(allFilters, remainingFilters));
  }

  if (search && search.term) {
    filterFunctions.push(createSearchFilter(search.term, search.fields));
  }

  if (customFilter) {
    filterFunctions.push(customFilter);
  }

  const combinedFilter =
    filterFunctions.length > 0 ? combineFilters(...filterFunctions) : () => true;

  // Cursor-based pagination with early termination
  const { numItems, cursor } = pagination;
  const items: T[] = [];
  let foundCursor = cursor === null;
  let hasMore = false;

  for await (const item of query) {
    // Skip until we find the cursor position
    if (!foundCursor) {
      if ((item as any)._id === cursor) {
        foundCursor = true;
      }
      continue;
    }

    // Apply filter
    if (!combinedFilter(item as T)) {
      continue;
    }

    items.push(item as T);

    // Fetch numItems + 1 to determine hasMore
    if (items.length > numItems) {
      hasMore = true;
      items.pop();
      break;
    }
  }

  return {
    page: items,
    isDone: !hasMore,
    continueCursor: items.length > 0 ? (items[items.length - 1] as any)._id : '',
  };
}

/**
 * Helper to create standard index configurations for a table
 *
 * @example
 * ```ts
 * const customerIndexes = createIndexConfigs('customers', [
 *   ['organizationId'],
 *   ['organizationId', 'status'],
 *   ['organizationId', 'email'],
 * ]);
 * ```
 */
export function createIndexConfigs(
  table: string,
  indexFields: string[][],
): IndexConfig[] {
  return indexFields.map((fields) => ({
    name: `by_${fields.join('_and_')}`,
    fields,
    priority: fields.length, // More fields = higher priority
  }));
}

/**
 * Pagination helper functions
 *
 * These helpers provide optimized pagination for different use cases:
 * 1. paginateWithFilter - For cursor-based pagination with in-memory filtering
 * 2. offsetPaginate - For offset-based pagination from a collected array
 */

import type { GenericDocument } from 'convex/server';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  type CursorPaginatedResult,
  type OffsetPaginatedResult,
} from './types';

/**
 * Paginate results with in-memory filtering using async iteration.
 *
 * This is optimized for cases where:
 * - Index narrows down results significantly
 * - Additional filtering is needed that can't be done via index
 * - Results need cursor-based pagination
 *
 * Performance notes:
 * - Uses early termination: stops as soon as numItems + 1 are found
 * - The +1 is to determine hasMore without fetching extra data
 * - Cursor handling is done efficiently via async iteration
 */
export async function paginateWithFilter<T extends GenericDocument>(
  query: AsyncIterable<T>,
  options: {
    numItems: number;
    cursor: string | null;
    filter?: (item: T) => boolean;
  },
): Promise<CursorPaginatedResult<T>> {
  const { numItems, cursor, filter } = options;
  const items: T[] = [];
  let foundCursor = cursor === null;
  let hasMore = false;

  for await (const item of query) {
    // Skip until we find the cursor position
    if (!foundCursor) {
      if (item._id === cursor) {
        foundCursor = true;
      }
      continue;
    }

    // Apply filter if provided
    if (filter && !filter(item)) {
      continue;
    }

    items.push(item);

    // We fetch numItems + 1 to know if there's more
    if (items.length > numItems) {
      hasMore = true;
      items.pop(); // Remove the extra item
      break;
    }
  }

  return {
    page: items,
    isDone: !hasMore,
    continueCursor: items.length > 0 ? (items[items.length - 1]._id as string) : '',
  };
}

/**
 * Create an offset-paginated result from an array.
 *
 * Use this when you need traditional page navigation.
 * Note: This requires knowing the total count upfront.
 */
export function offsetPaginate<T>(
  items: T[],
  options: {
    page?: number;
    pageSize?: number;
  },
): OffsetPaginatedResult<T> {
  const page = Math.max(options.page ?? DEFAULT_PAGE, 1);
  const pageSize = Math.min(
    Math.max(options.pageSize ?? DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE,
  );

  const total = items.length;
  const totalPages = Math.ceil(total / pageSize);
  const startIndex = (page - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedItems = items.slice(startIndex, endIndex);

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
 * Normalize pagination options with defaults
 */
export function normalizePaginationOptions(options?: {
  page?: number;
  pageSize?: number;
}): { page: number; pageSize: number } {
  return {
    page: Math.max(options?.page ?? DEFAULT_PAGE, 1),
    pageSize: Math.min(
      Math.max(options?.pageSize ?? DEFAULT_PAGE_SIZE, 1),
      MAX_PAGE_SIZE,
    ),
  };
}

/**
 * Calculate pagination metadata from total count
 */
export function calculatePaginationMeta(
  total: number,
  page: number,
  pageSize: number,
): {
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
} {
  const totalPages = Math.ceil(total / pageSize);
  return {
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}

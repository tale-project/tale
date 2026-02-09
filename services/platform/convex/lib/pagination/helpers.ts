import type { GenericDocument } from 'convex/server';

import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  type CursorPaginatedResult,
} from './types';

export async function paginateWithFilter<T extends GenericDocument>(
  query: AsyncIterable<T>,
  options: {
    numItems: number;
    cursor: string | null;
    filter?: (item: T) => boolean;
    maxScanItems?: number;
  },
): Promise<CursorPaginatedResult<T>> {
  const { numItems, cursor, filter, maxScanItems = 500 } = options;
  const items: T[] = [];
  let foundCursor = cursor === null;
  let hasMore = false;
  let scanned = 0;

  for await (const item of query) {
    scanned++;

    if (!foundCursor) {
      if (item._id === cursor) {
        foundCursor = true;
      }
      continue;
    }

    if (filter && !filter(item)) {
      if (scanned >= maxScanItems) {
        break;
      }
      continue;
    }

    items.push(item);

    if (items.length > numItems) {
      hasMore = true;
      items.pop();
      break;
    }

    if (scanned >= maxScanItems) {
      break;
    }
  }

  return {
    page: items,
    isDone: !hasMore,
    continueCursor:
      items.length > 0 ? (items[items.length - 1]._id as string) : '',
  };
}

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

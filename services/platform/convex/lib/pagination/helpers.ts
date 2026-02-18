import type { GenericDocument } from 'convex/server';

import type { CursorPaginatedResult } from './types';

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
    // oxlint-disable-next-line typescript/no-base-to-string -- GenericId<string> extends string, String() is safe
    continueCursor: items.length > 0 ? String(items[items.length - 1]._id) : '',
  };
}

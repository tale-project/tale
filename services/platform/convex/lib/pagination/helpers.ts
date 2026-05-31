import type { GenericDocument } from 'convex/server';

import type { CursorPaginatedResult } from './types';

// A Convex `_id` is a GenericId<string> (extends string), so String() never
// hits Object's default stringification. Localize the one lint exception here.
function idStr(id: unknown): string {
  // oxlint-disable-next-line typescript/no-base-to-string -- GenericId<string> extends string, String() is safe
  return String(id);
}

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
  // Id to resume AFTER on the next page. For a full page it is the last
  // INCLUDED item; for a scan-budget break it is the last SCANNED item (which
  // may have been filtered out). Tracking the scanned id is what lets a
  // heavily-filtered listing page through its tail instead of falsely
  // reporting isDone at maxScanItems — the bug that made external-sync
  // reconcile (queryDocuments + isActiveDocument) miss existing docs beyond
  // the first maxScanItems scanned and re-create duplicates.
  let resumeCursor = '';

  for await (const item of query) {
    scanned++;

    if (!foundCursor) {
      if (item._id === cursor) {
        foundCursor = true;
      }
      continue;
    }

    const id = idStr(item._id);

    if (filter && !filter(item)) {
      if (scanned >= maxScanItems) {
        // Scan budget hit on a filtered-out row — matches may remain. Report
        // hasMore and resume after this scanned row so the tail is paged.
        hasMore = true;
        resumeCursor = id;
        break;
      }
      continue;
    }

    items.push(item);
    resumeCursor = id;

    if (items.length > numItems) {
      hasMore = true;
      items.pop();
      // The popped item begins the next page; resume after the last INCLUDED.
      resumeCursor = items.length > 0 ? idStr(items[items.length - 1]._id) : '';
      break;
    }

    if (scanned >= maxScanItems) {
      // Scan budget hit right after including this row — resume after it.
      hasMore = true;
      break;
    }
  }

  const lastIncluded =
    items.length > 0 ? idStr(items[items.length - 1]._id) : '';
  return {
    page: items,
    isDone: !hasMore,
    continueCursor: hasMore ? resumeCursor : lastIncluded,
  };
}

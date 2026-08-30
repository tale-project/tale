import type { OptimisticLocalStore } from 'convex/browser';
import type { PaginatedQueryReference } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';

import { readDocumentId } from '@/app/hooks/optimistic-updates';

export type {
  PaginatedQueryArgs,
  PaginatedQueryReference,
  UsePaginatedQueryReturnType,
  UsePaginatedQueryResult,
} from 'convex/react';

// Re-export Convex's paginated optimistic helpers through this single chokepoint
// so app code never reaches into `convex/react` directly for them.
export {
  insertAtTop,
  insertAtPosition,
  optimisticallyUpdateValueInPaginatedQuery,
} from 'convex/react';

/**
 * Optimistically remove the matching `_id` item from every loaded page of a
 * paginated query, across all argument variants currently in the store. Convex
 * ships no paginated "remove" helper, so we filter the loaded `page` arrays;
 * the server reconciles the cursors when the mutation settles.
 */
export function removeItemFromPaginatedQuery<
  Query extends PaginatedQueryReference,
>(store: OptimisticLocalStore, query: Query, id: string): void {
  for (const { args, value } of store.getAllQueries(query)) {
    if (value === undefined || value === null) continue;
    store.setQuery(query, args, {
      ...value,
      page: value.page.filter((item) => readDocumentId(item) !== id),
    });
  }
}

/** The element type of a paginated query's `page`. */
type PaginatedItemOf<Query extends PaginatedQueryReference> =
  FunctionReturnType<Query> extends { page: ReadonlyArray<infer Item> }
    ? Item
    : never;

/**
 * Optimistically update the matching `_id` item in every loaded page of a
 * paginated query, across all argument variants currently in the store. Mirrors
 * {@link removeItemFromPaginatedQuery} for in-place edits (e.g. a rename); the
 * server reconciles the value when the mutation settles.
 */
export function updateItemInPaginatedQuery<
  Query extends PaginatedQueryReference,
>(
  store: OptimisticLocalStore,
  query: Query,
  id: string,
  update: (item: PaginatedItemOf<Query>) => PaginatedItemOf<Query>,
): void {
  for (const { args, value } of store.getAllQueries(query)) {
    if (value === undefined || value === null) continue;
    store.setQuery(query, args, {
      ...value,
      page: value.page.map((item) =>
        readDocumentId(item) === id ? update(item) : item,
      ),
    });
  }
}

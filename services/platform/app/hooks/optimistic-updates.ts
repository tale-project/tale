import type { OptimisticLocalStore } from 'convex/browser';
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from 'convex/server';

/**
 * Typed building blocks for Convex optimistic updates, composed inside the
 * `optimisticUpdate` option of `useConvexMutation`.
 *
 * The patch is applied to the live Convex query store; it propagates to every
 * `useConvexQuery` reading the same query and is rolled back automatically when
 * the mutation settles (Convex replays still-pending updates on each server
 * transition). So these helpers never write rollback logic, and a no-op when the
 * target query isn't currently mounted is the correct behaviour — an unread
 * query has nothing to update.
 *
 * `update`/`remove` operate across every loaded argument variant of a list
 * query (e.g. all filter combinations) so a delete/rename keyed by `_id` lands
 * regardless of which filtered view is on screen. Only use these when the
 * optimistic value is a straightforward projection of the mutation's inputs —
 * server-derived/aggregate results (counts, signed URLs) must not be guessed.
 */

type ListItemOf<Query extends FunctionReference<'query'>> =
  FunctionReturnType<Query> extends ReadonlyArray<infer Item> ? Item : never;

/** Read a Convex document `_id` from an unknown list item without casts. */
function readDocumentId(item: unknown): string | undefined {
  if (typeof item === 'object' && item !== null && '_id' in item) {
    const id = item._id;
    return typeof id === 'string' ? id : undefined;
  }
  return undefined;
}

/**
 * Replace the value of a single-document query (e.g. a settings/governance
 * policy). The `update` callback receives the current, non-null value and
 * returns the next one — caller-side types are concrete, so spreading is safe.
 */
export function updateDocumentQuery<Query extends FunctionReference<'query'>>(
  store: OptimisticLocalStore,
  query: Query,
  args: FunctionArgs<Query>,
  update: (
    current: NonNullable<FunctionReturnType<Query>>,
  ) => FunctionReturnType<Query>,
): void {
  const current = store.getQuery(query, args);
  if (current === undefined || current === null) return;
  store.setQuery(query, args, update(current));
}

/** Update the matching `_id` item in every loaded variant of a list query. */
export function updateItemInListQuery<Query extends FunctionReference<'query'>>(
  store: OptimisticLocalStore,
  query: Query,
  id: string,
  update: (item: ListItemOf<Query>) => ListItemOf<Query>,
): void {
  for (const { args, value } of store.getAllQueries(query)) {
    if (!Array.isArray(value)) continue;
    store.setQuery(
      query,
      args,
      value.map((item: ListItemOf<Query>) =>
        readDocumentId(item) === id ? update(item) : item,
      ),
    );
  }
}

/** Remove the matching `_id` item from every loaded variant of a list query. */
export function removeItemFromListQuery<
  Query extends FunctionReference<'query'>,
>(store: OptimisticLocalStore, query: Query, id: string): void {
  for (const { args, value } of store.getAllQueries(query)) {
    if (!Array.isArray(value)) continue;
    store.setQuery(
      query,
      args,
      value.filter((item: ListItemOf<Query>) => readDocumentId(item) !== id),
    );
  }
}

/**
 * Insert an item into a specific list query at the start (default) or end.
 * Unlike remove/update, insert targets one argument variant — inserting into
 * every filtered view would place the row in lists it doesn't belong to.
 */
export function insertItemIntoListQuery<
  Query extends FunctionReference<'query'>,
>(
  store: OptimisticLocalStore,
  query: Query,
  args: FunctionArgs<Query>,
  item: ListItemOf<Query>,
  position: 'start' | 'end' = 'start',
): void {
  const current = store.getQuery(query, args);
  if (!Array.isArray(current)) return;
  store.setQuery(
    query,
    args,
    position === 'start' ? [item, ...current] : [...current, item],
  );
}

export type { ListItemOf };
export { readDocumentId };

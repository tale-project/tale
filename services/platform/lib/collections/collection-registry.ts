import type { Collection } from '@tanstack/db';
import type { QueryClient, QueryFunction } from '@tanstack/react-query';
import type { ConvexReactClient } from 'convex/react';

import { createCollection } from '@tanstack/react-db';

type CollectionFactory<T extends object, TKey extends string | number> = (
  scopeId: string,
  queryClient: QueryClient,
  convexQueryFn: QueryFunction,
  convexClient: ConvexReactClient,
) => Parameters<typeof createCollection<T, TKey>>[0];

// Cache stores heterogeneous Collection instances keyed by `${name}:${scopeId}`.
// We use `unknown` since each entry may have a different T/TKey; callers narrow
// via the generic return type of `getOrCreateCollection`.
const collectionCache = new Map<string, unknown>();

/**
 * Get an existing collection from the cache or create a new one.
 * Collections are keyed by `${name}:${scopeId}` to ensure
 * each scope (organization, entity, user) has its own isolated collection instance.
 */
export function getOrCreateCollection<
  T extends object,
  TKey extends string | number = string,
>(
  name: string,
  scopeId: string,
  factory: CollectionFactory<T, TKey>,
  queryClient: QueryClient,
  convexQueryFn: QueryFunction,
  convexClient: ConvexReactClient,
): Collection<T, TKey> {
  const cacheKey = `${name}:${scopeId}`;
  let collection = collectionCache.get(cacheKey);

  if (!collection) {
    const options = factory(scopeId, queryClient, convexQueryFn, convexClient);
    collection = createCollection(options);
    collectionCache.set(cacheKey, collection);
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Heterogeneous cache stores different Collection types; the factory for a given name always produces Collection<T, TKey>
  return collection as Collection<T, TKey>;
}

/**
 * Clear cached collections. If scopeId is provided, only collections
 * for that scope are cleared. Otherwise all collections are cleared.
 * Call this when a user switches organizations or signs out.
 */
export function clearCollections(scopeId?: string) {
  if (scopeId) {
    for (const key of collectionCache.keys()) {
      if (key.endsWith(`:${scopeId}`)) {
        collectionCache.delete(key);
      }
    }
  } else {
    collectionCache.clear();
  }
}

export type { CollectionFactory };

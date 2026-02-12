import type { Collection } from '@tanstack/db';

import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useConvexClient } from '@/app/hooks/use-convex-client';

import type { CollectionFactory } from './collection-registry';

import { getOrCreateCollection } from './collection-registry';

/**
 * React hook that provides access to a TanStack DB collection backed by a Convex query.
 * Collections are lazily created and cached per scope.
 *
 * @param name - Unique name for this collection type (e.g. 'products', 'customers')
 * @param factory - Factory function that creates the collection options
 * @param scopeId - Scope identifier for the collection (organizationId, entityId, userId, etc.)
 * @returns A TanStack DB Collection instance
 *
 * @example
 * ```tsx
 * const collection = useCollection('products', createProductsCollection, organizationId);
 * const { data } = useLiveQuery((q) => q.from({ p: collection }));
 * ```
 */
export function useCollection<
  T extends object,
  TKey extends string | number = string,
>(
  name: string,
  factory: CollectionFactory<T, TKey>,
  scopeId: string,
): Collection<T, TKey> {
  const queryClient = useQueryClient();
  const convexClient = useConvexClient();

  // ConvexQueryClient sets a default queryFn on the QueryClient that establishes
  // WebSocket subscriptions for queries with "convexQuery" key prefix. Extract it
  // so we can pass it to queryCollectionOptions for its internal QueryObserver.
  const defaultQueryFn = queryClient.getDefaultOptions().queries?.queryFn;
  if (!defaultQueryFn || typeof defaultQueryFn === 'symbol') {
    throw new Error(
      'useCollection requires a default queryFn on QueryClient (set by ConvexQueryClient)',
    );
  }
  const convexQueryFn = defaultQueryFn;

  return useMemo(
    () =>
      getOrCreateCollection(
        name,
        scopeId,
        factory,
        queryClient,
        convexQueryFn,
        convexClient,
      ),
    [name, scopeId, factory, queryClient, convexQueryFn, convexClient],
  );
}

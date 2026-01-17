import { useMutation } from 'convex/react';
import { useCallback, useState } from 'react';
import type { FunctionReference } from 'convex/server';
import { addToQueue } from '@/lib/offline';
import {
  updateCacheItemById,
  appendToCacheItem,
  removeCacheItemById,
  createCacheKey,
} from '@/lib/offline/cache-manager';
import { useOnlineStatus } from './use-online-status';

type MutationType = 'create' | 'update' | 'delete';

interface OfflineMutationConfig<TArgs, TItem> {
  mutationFn: FunctionReference<'mutation', 'public'>;
  queryName: string;
  type: MutationType;
  getItemId?: (args: TArgs) => string;
  getOptimisticItem?: (args: TArgs) => Partial<TItem>;
}

interface UseOfflineMutationReturn<TArgs> {
  mutate: (args: TArgs) => Promise<string | unknown>;
  isPending: boolean;
  isOffline: boolean;
  error: Error | null;
}

export function createOfflineMutation<
  TArgs extends Record<string, unknown>,
  TItem extends { _id: string },
>(config: OfflineMutationConfig<TArgs, TItem>) {
  return function useOfflineMutation(
    organizationId: string
  ): UseOfflineMutationReturn<TArgs> {
    const isOnline = useOnlineStatus();
    const [isPending, setIsPending] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    const onlineMutation = useMutation(config.mutationFn);
    const cacheKey = createCacheKey(config.queryName, organizationId);

    const mutate = useCallback(
      async (args: TArgs): Promise<string | unknown> => {
        setIsPending(true);
        setError(null);

        try {
          if (isOnline) {
            const result = await onlineMutation(args);
            return result;
          }

          const queueId = await addToQueue({
            mutationFn: config.mutationFn.toString(),
            args,
            optimisticData: config.getOptimisticItem?.(args),
          });

          if (config.type === 'create' && config.getOptimisticItem) {
            const optimisticItem = {
              ...config.getOptimisticItem(args),
              _id: `temp_${queueId}`,
              _creationTime: Date.now(),
            } as TItem;
            await appendToCacheItem<TItem>(cacheKey, optimisticItem);
          } else if (config.type === 'update' && config.getItemId) {
            const itemId = config.getItemId(args);
            const updates = config.getOptimisticItem?.(args);
            if (updates) {
              await updateCacheItemById<TItem>(cacheKey, itemId, updates);
            }
          } else if (config.type === 'delete' && config.getItemId) {
            const itemId = config.getItemId(args);
            await removeCacheItemById<TItem>(cacheKey, itemId);
          }

          return queueId;
        } catch (err) {
          const errorObj =
            err instanceof Error ? err : new Error(String(err));
          setError(errorObj);
          throw errorObj;
        } finally {
          setIsPending(false);
        }
      },
      [isOnline, onlineMutation, cacheKey]
    );

    return {
      mutate,
      isPending,
      isOffline: !isOnline,
      error,
    };
  };
}

export function createOfflineUpdateMutation<
  TArgs extends Record<string, unknown> & { id: string },
  TItem extends { _id: string },
>(
  mutationFn: FunctionReference<'mutation', 'public'>,
  queryName: string,
  getOptimisticItem?: (args: TArgs) => Partial<TItem>
) {
  return createOfflineMutation<TArgs, TItem>({
    mutationFn,
    queryName,
    type: 'update',
    getItemId: (args) => args.id,
    getOptimisticItem,
  });
}

export function createOfflineDeleteMutation<
  TArgs extends Record<string, unknown> & { id: string },
  TItem extends { _id: string },
>(mutationFn: FunctionReference<'mutation', 'public'>, queryName: string) {
  return createOfflineMutation<TArgs, TItem>({
    mutationFn,
    queryName,
    type: 'delete',
    getItemId: (args) => args.id,
  });
}

export function createOfflineCreateMutation<
  TArgs extends Record<string, unknown>,
  TItem extends { _id: string },
>(
  mutationFn: FunctionReference<'mutation', 'public'>,
  queryName: string,
  getOptimisticItem: (args: TArgs) => Partial<TItem>
) {
  return createOfflineMutation<TArgs, TItem>({
    mutationFn,
    queryName,
    type: 'create',
    getOptimisticItem,
  });
}

import type { FunctionReference, FunctionReturnType } from 'convex/server';

import { convexQuery } from '@convex-dev/react-query';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useEffect, useState } from 'react';

import { createCacheKey, getQueryCache, setQueryCache } from '@/lib/offline';
import {
  filterByFields,
  filterByTextSearch,
  sortByString,
  sortByDate,
  sortByNumber,
  type SortOrder,
} from '@/lib/utils/client-utils';

import { useOnlineStatus } from './use-online-status';

type QueryFunction = FunctionReference<
  'query',
  'public',
  { organizationId: string },
  unknown[]
>;

interface SortFieldConfig<TSortBy extends string, TItem> {
  string: TSortBy[];
  date: TSortBy[];
  number: TSortBy[];
  fieldMap?: Partial<Record<TSortBy, keyof TItem>>;
}

interface OfflineEntityDataConfig<
  TQuery extends QueryFunction,
  TItem extends FunctionReturnType<TQuery>[number],
  TSortBy extends string,
> {
  queryFn: TQuery;
  queryName: string;
  searchFields: (keyof TItem)[];
  sortConfig: SortFieldConfig<TSortBy, TItem>;
  defaultSort: { field: TSortBy; order: SortOrder };
}

interface UseOfflineEntityDataOptions<TFilters, TSortBy extends string> {
  organizationId: string;
  search?: string;
  filters?: TFilters;
  sortBy?: TSortBy;
  sortOrder?: SortOrder;
}

interface UseOfflineEntityDataReturn<TItem> {
  data: TItem[];
  totalCount: number;
  filteredCount: number;
  isLoading: boolean;
  isOffline: boolean;
  isStale: boolean;
  lastSyncTime: Date | null;
}

export function createOfflineEntityDataHook<
  TQuery extends QueryFunction,
  TItem extends FunctionReturnType<TQuery>[number],
  TFilters extends Record<string, string[]>,
  TSortBy extends string,
>(config: OfflineEntityDataConfig<TQuery, TItem, TSortBy>) {
  return function useOfflineEntityData(
    options: UseOfflineEntityDataOptions<TFilters, TSortBy>,
  ): UseOfflineEntityDataReturn<TItem> {
    const {
      organizationId,
      search = '',
      filters,
      sortBy = config.defaultSort.field,
      sortOrder = config.defaultSort.order,
    } = options;

    const isOnline = useOnlineStatus();
    const [cachedData, setCachedData] = useState<TItem[] | null>(null);
    const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
    const [isLoadingCache, setIsLoadingCache] = useState(true);

    const cacheKey = createCacheKey(config.queryName, organizationId);

    const queryArgs = isOnline ? { organizationId } : 'skip';
    // @ts-expect-error convexQuery requires exact FunctionReference; generic QueryFunction is not directly assignable
    const queryOptions = convexQuery(config.queryFn, queryArgs);
    const { data: liveData, isLoading: isLiveLoading } = useQuery(queryOptions);

    useEffect(() => {
      let mounted = true;

      async function loadCache() {
        setIsLoadingCache(true);
        const cached = await getQueryCache<TItem>(cacheKey);
        if (mounted) {
          setCachedData(cached);
          if (cached) {
            setLastSyncTime(new Date());
          }
          setIsLoadingCache(false);
        }
      }

      void loadCache();

      return () => {
        mounted = false;
      };
    }, [cacheKey]);

    useEffect(() => {
      if (isOnline && liveData) {
        void setQueryCache(cacheKey, liveData, organizationId);
        // @ts-expect-error QueryFunction returns unknown[]; liveData contains TItem elements from config.queryFn
        setCachedData(liveData);
        setLastSyncTime(new Date());
      }
    }, [isOnline, liveData, cacheKey, organizationId]);

    const sourceData = isOnline ? liveData : cachedData;
    const isStale = !isOnline && cachedData !== null;

    const processed = useMemo(() => {
      if (!sourceData) return [];

      // @ts-expect-error QueryFunction returns unknown[]; TItem is the actual element type from config.queryFn
      let result: TItem[] = sourceData;

      if (search) {
        result = filterByTextSearch(result, search, config.searchFields);
      }

      if (filters) {
        const entries = Object.entries(filters)
          .filter(([, values]) => Array.isArray(values) && values.length > 0)
          .map(([field, values]) => ({ field, values: new Set(values) }));

        if (entries.length > 0) {
          // @ts-expect-error Object.entries returns string keys; filter keys match TItem fields by convention
          result = filterByFields(result, entries);
        }
      }

      const getSorter = () => {
        // @ts-expect-error TSortBy is a semantic sort key; without a fieldMap entry, sortBy is used as keyof TItem
        const actualField: keyof TItem =
          config.sortConfig.fieldMap?.[sortBy] ?? sortBy;
        if (config.sortConfig.number.includes(sortBy)) {
          return sortByNumber<TItem>(actualField, sortOrder);
        }
        if (config.sortConfig.date.includes(sortBy)) {
          return sortByDate<TItem>(actualField, sortOrder);
        }
        return sortByString<TItem>(actualField, sortOrder);
      };

      return [...result].sort(getSorter());
    }, [sourceData, search, filters, sortBy, sortOrder]);

    const isLoading =
      (isOnline && isLiveLoading) || (!isOnline && isLoadingCache);

    return {
      data: processed,
      totalCount: sourceData?.length ?? 0,
      filteredCount: processed.length,
      isLoading,
      isOffline: !isOnline,
      isStale,
      lastSyncTime,
    };
  };
}

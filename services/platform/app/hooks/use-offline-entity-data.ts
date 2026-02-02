import { useQuery } from 'convex/react';
import { useMemo, useEffect, useState } from 'react';
import type { FunctionReference, FunctionReturnType } from 'convex/server';
import {
  filterByFields,
  filterByTextSearch,
  sortByString,
  sortByDate,
  sortByNumber,
  type SortOrder,
} from '@/lib/utils/client-utils';
import {
  createCacheKey,
  getQueryCache,
  setQueryCache,
} from '@/lib/offline';
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
    options: UseOfflineEntityDataOptions<TFilters, TSortBy>
  ): UseOfflineEntityDataReturn<TItem> {
    const {
      organizationId,
      search = '',
      filters = {} as TFilters,
      sortBy = config.defaultSort.field,
      sortOrder = config.defaultSort.order,
    } = options;

    const isOnline = useOnlineStatus();
    const [cachedData, setCachedData] = useState<TItem[] | null>(null);
    const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
    const [isLoadingCache, setIsLoadingCache] = useState(true);

    const cacheKey = createCacheKey(config.queryName, organizationId);

     
    const liveData = useQuery(
      config.queryFn as any,
      isOnline ? { organizationId } : 'skip'
    );

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

      loadCache();

      return () => {
        mounted = false;
      };
    }, [cacheKey]);

    useEffect(() => {
      if (isOnline && liveData) {
        setQueryCache(cacheKey, liveData as TItem[], organizationId);
        setCachedData(liveData as TItem[]);
        setLastSyncTime(new Date());
      }
    }, [isOnline, liveData, cacheKey, organizationId]);

    const sourceData = isOnline ? liveData : cachedData;
    const isStale = !isOnline && cachedData !== null;

    const processed = useMemo(() => {
      if (!sourceData) return [];

      let result = sourceData as TItem[];

      if (search) {
        result = filterByTextSearch(result, search, config.searchFields);
      }

      const activeFilters = Object.entries(filters)
        .filter(([, values]) => Array.isArray(values) && values.length > 0)
        .map(([field, values]) => ({
          field: field as keyof TItem,
          values: new Set(values),
        }));

      if (activeFilters.length > 0) {
        result = filterByFields(result, activeFilters);
      }

      const getSorter = () => {
        const actualField =
          config.sortConfig.fieldMap?.[sortBy] ?? (sortBy as unknown as keyof TItem);
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
      (isOnline && liveData === undefined) || (!isOnline && isLoadingCache);

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

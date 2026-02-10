import type { FunctionReference, FunctionReturnType } from 'convex/server';

import { convexQuery } from '@convex-dev/react-query';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  filterByFields,
  filterByTextSearch,
  sortByString,
  sortByDate,
  sortByNumber,
  type SortOrder,
} from '@/lib/utils/client-utils';

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

interface EntityDataConfig<
  TQuery extends QueryFunction,
  TItem extends FunctionReturnType<TQuery>[number],
  TSortBy extends string,
> {
  queryFn: TQuery;
  searchFields: (keyof TItem)[];
  sortConfig: SortFieldConfig<TSortBy, TItem>;
  defaultSort: { field: TSortBy; order: SortOrder };
}

interface UseEntityDataOptions<TFilters, TSortBy extends string> {
  organizationId: string;
  search?: string;
  filters?: TFilters;
  sortBy?: TSortBy;
  sortOrder?: SortOrder;
}

interface UseEntityDataReturn<TItem> {
  data: TItem[];
  totalCount: number;
  filteredCount: number;
  isLoading: boolean;
}

export function createEntityDataHook<
  TQuery extends QueryFunction,
  TItem extends FunctionReturnType<TQuery>[number],
  TFilters extends Record<string, string[]>,
  TSortBy extends string,
>(config: EntityDataConfig<TQuery, TItem, TSortBy>) {
  return function useEntityData(
    options: UseEntityDataOptions<TFilters, TSortBy>,
  ): UseEntityDataReturn<TItem> {
    const {
      organizationId,
      search = '',
      filters,
      sortBy = config.defaultSort.field,
      sortOrder = config.defaultSort.order,
    } = options;

    // @ts-expect-error convexQuery requires exact FunctionReference; generic QueryFunction is not directly assignable
    const queryOptions = convexQuery(config.queryFn, { organizationId });
    const { data: allItems, isLoading: isQueryLoading } =
      useQuery(queryOptions);

    const processed = useMemo(() => {
      if (!allItems) return [];

      // @ts-expect-error QueryFunction returns unknown[]; TItem is the actual element type from config.queryFn
      let result: TItem[] = allItems;

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
    }, [allItems, search, filters, sortBy, sortOrder]);

    return {
      data: processed,
      totalCount: allItems?.length ?? 0,
      filteredCount: processed.length,
      isLoading: isQueryLoading,
    };
  };
}

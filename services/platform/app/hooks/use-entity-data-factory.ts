import type { FunctionReference, FunctionReturnType } from 'convex/server';

import { useQuery } from 'convex/react';
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
      // {} is not assignable to arbitrary TFilters — cast required for default
      filters = {} as TFilters,
      sortBy = config.defaultSort.field,
      sortOrder = config.defaultSort.order,
    } = options;

    // oxlint-disable-next-line typescript/no-explicit-any -- Convex useQuery requires exact FunctionReference type; generic QueryFunction is not assignable
    const allItems = useQuery(config.queryFn as any, { organizationId });

    const processed = useMemo(() => {
      if (!allItems) return [];

      // Convex useQuery returns unknown[] — cast required to apply generic TItem
      let result = allItems as TItem[];

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
          config.sortConfig.fieldMap?.[sortBy] ??
          (sortBy as unknown as keyof TItem);
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
      isLoading: allItems === undefined,
    };
  };
}

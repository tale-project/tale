import { useQuery } from 'convex/react';
import { useMemo } from 'react';
import { api } from '@/convex/_generated/api';
import {
  filterByFields,
  filterByTextSearch,
  sortByString,
  sortByDate,
  sortByNumber,
  type SortOrder,
} from '@/lib/utils/client-utils';

interface UseProductsDataOptions {
  organizationId: string;
  search?: string;
  status?: string[];
  category?: string[];
  sortBy?: 'name' | 'createdAt' | 'lastUpdated' | 'stock' | 'price';
  sortOrder?: SortOrder;
}

export function useProductsData(options: UseProductsDataOptions) {
  const {
    organizationId,
    search = '',
    status = [],
    category = [],
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = options;

  const allProducts = useQuery(
    api.queries.products.getAllProducts,
    { organizationId },
  );

  const processed = useMemo(() => {
    if (!allProducts) return [];

    let result = allProducts;

    if (search) {
      result = filterByTextSearch(result, search, [
        'name',
        'description',
        'category',
      ]);
    }

    const filters = [];
    if (status.length > 0) {
      filters.push({ field: 'status' as const, values: new Set(status) });
    }
    if (category.length > 0) {
      filters.push({ field: 'category' as const, values: new Set(category) });
    }

    if (filters.length > 0) {
      result = filterByFields(result, filters);
    }

    return [...result].sort(
      sortBy === 'stock' || sortBy === 'price'
        ? sortByNumber(sortBy, sortOrder)
        : sortBy === 'createdAt' || sortBy === 'lastUpdated'
          ? sortByDate(sortBy, sortOrder)
          : sortByString(sortBy, sortOrder),
    );
  }, [allProducts, search, status, category, sortBy, sortOrder]);

  return {
    data: processed,
    totalCount: allProducts?.length ?? 0,
    filteredCount: processed.length,
    isLoading: allProducts === undefined,
  };
}

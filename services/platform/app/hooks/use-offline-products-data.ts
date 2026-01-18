import { api } from '@/convex/_generated/api';
import { createOfflineEntityDataHook } from './use-offline-entity-data';
import type { SortOrder } from '@/lib/utils/client-utils';

type ProductSortBy = 'name' | 'createdAt' | 'lastUpdated' | 'stock' | 'price';

interface ProductFilters {
  status: string[];
  category: string[];
}

const useOfflineProductsDataBase = createOfflineEntityDataHook({
  queryFn: api.products.queries.getAllProducts,
  queryName: 'products.getAllProducts',
  searchFields: ['name', 'description', 'category'],
  sortConfig: {
    string: ['name'] as ProductSortBy[],
    date: ['createdAt', 'lastUpdated'] as ProductSortBy[],
    number: ['stock', 'price'] as ProductSortBy[],
  },
  defaultSort: {
    field: 'createdAt' as ProductSortBy,
    order: 'desc' as SortOrder,
  },
});

interface UseOfflineProductsDataOptions {
  organizationId: string;
  search?: string;
  status?: string[];
  category?: string[];
  sortBy?: ProductSortBy;
  sortOrder?: SortOrder;
}

export function useOfflineProductsData(options: UseOfflineProductsDataOptions) {
  const { status = [], category = [], ...rest } = options;

  return useOfflineProductsDataBase({
    ...rest,
    filters: { status, category },
  });
}

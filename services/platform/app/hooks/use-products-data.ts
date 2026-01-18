import { api } from '@/convex/_generated/api';
import { createEntityDataHook } from './use-entity-data-factory';
import type { SortOrder } from '@/lib/utils/client-utils';

type ProductSortBy = 'name' | 'createdAt' | 'lastUpdated' | 'stock' | 'price';

interface ProductFilters {
  status: string[];
  category: string[];
}

const useProductsDataBase = createEntityDataHook({
  queryFn: api.products.queries.getAllProducts,
  searchFields: ['name', 'description', 'category'],
  sortConfig: {
    string: ['name'] as ProductSortBy[],
    date: ['createdAt', 'lastUpdated'] as ProductSortBy[],
    number: ['stock', 'price'] as ProductSortBy[],
  },
  defaultSort: { field: 'createdAt' as ProductSortBy, order: 'desc' as SortOrder },
});

interface UseProductsDataOptions {
  organizationId: string;
  search?: string;
  status?: string[];
  category?: string[];
  sortBy?: ProductSortBy;
  sortOrder?: SortOrder;
}

export function useProductsData(options: UseProductsDataOptions) {
  const { status = [], category = [], ...rest } = options;

  return useProductsDataBase({
    ...rest,
    filters: { status, category },
  });
}

import { api } from '@/convex/_generated/api';
import { createEntityDataHook } from './use-entity-data-factory';
import type { SortOrder } from '@/lib/utils/client-utils';

type VendorSortBy = 'name' | 'email' | '_creationTime';

interface VendorFilters {
  source: string[];
  locale: string[];
}

const useVendorsDataBase = createEntityDataHook({
  queryFn: api.vendors.queries.getAllVendors,
  searchFields: ['name', 'email', 'externalId'],
  sortConfig: {
    string: ['name', 'email'] as VendorSortBy[],
    date: ['_creationTime'] as VendorSortBy[],
    number: [] as VendorSortBy[],
  },
  defaultSort: { field: 'name' as VendorSortBy, order: 'asc' as SortOrder },
});

interface UseVendorsDataOptions {
  organizationId: string;
  search?: string;
  source?: string[];
  locale?: string[];
  sortBy?: VendorSortBy;
  sortOrder?: SortOrder;
}

export function useVendorsData(options: UseVendorsDataOptions) {
  const { source = [], locale = [], ...rest } = options;

  return useVendorsDataBase({
    ...rest,
    filters: { source, locale } as VendorFilters,
  });
}

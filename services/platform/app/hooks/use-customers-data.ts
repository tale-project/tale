import { api } from '@/convex/_generated/api';
import { createEntityDataHook } from './use-entity-data-factory';
import type { SortOrder } from '@/lib/utils/client-utils';

type CustomerSortBy = 'name' | 'email' | '_creationTime' | 'status';

interface CustomerFilters {
  status: string[];
  source: string[];
  locale: string[];
}

const useCustomersDataBase = createEntityDataHook({
  queryFn: api.queries.customers.getAllCustomers,
  searchFields: ['name', 'email', 'externalId'],
  sortConfig: {
    string: ['name', 'email', 'status'] as CustomerSortBy[],
    date: ['_creationTime'] as CustomerSortBy[],
    number: [] as CustomerSortBy[],
  },
  defaultSort: { field: '_creationTime' as CustomerSortBy, order: 'desc' as SortOrder },
});

interface UseCustomersDataOptions {
  organizationId: string;
  search?: string;
  status?: string[];
  source?: string[];
  locale?: string[];
  sortBy?: CustomerSortBy;
  sortOrder?: SortOrder;
}

export function useCustomersData(options: UseCustomersDataOptions) {
  const { status = [], source = [], locale = [], ...rest } = options;

  return useCustomersDataBase({
    ...rest,
    filters: { status, source, locale } as CustomerFilters,
  });
}

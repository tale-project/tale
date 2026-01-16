import { useQuery } from 'convex/react';
import { useMemo } from 'react';
import { api } from '@/convex/_generated/api';
import {
  filterByFields,
  filterByTextSearch,
  sortByString,
  sortByDate,
  type SortOrder,
} from '@/lib/utils/client-utils';

interface UseCustomersDataOptions {
  organizationId: string;
  search?: string;
  status?: string[];
  source?: string[];
  locale?: string[];
  sortBy?: 'name' | 'email' | '_creationTime' | 'status';
  sortOrder?: SortOrder;
}

export function useCustomersData(options: UseCustomersDataOptions) {
  const {
    organizationId,
    search = '',
    status = [],
    source = [],
    locale = [],
    sortBy = '_creationTime',
    sortOrder = 'desc',
  } = options;

  const allCustomers = useQuery(
    api.queries.customers.getAllCustomers,
    { organizationId },
  );

  const processed = useMemo(() => {
    if (!allCustomers) return [];

    let result = allCustomers;

    if (search) {
      result = filterByTextSearch(result, search, [
        'name',
        'email',
        'externalId',
      ]);
    }

    const filters = [];
    if (status.length > 0) {
      filters.push({ field: 'status' as const, values: new Set(status) });
    }
    if (source.length > 0) {
      filters.push({ field: 'source' as const, values: new Set(source) });
    }
    if (locale.length > 0) {
      filters.push({ field: 'locale' as const, values: new Set(locale) });
    }

    if (filters.length > 0) {
      result = filterByFields(result, filters);
    }

    return [...result].sort(
      sortBy === '_creationTime'
        ? sortByDate(sortBy, sortOrder)
        : sortByString(sortBy, sortOrder),
    );
  }, [allCustomers, search, status, source, locale, sortBy, sortOrder]);

  return {
    data: processed,
    totalCount: allCustomers?.length ?? 0,
    filteredCount: processed.length,
    isLoading: allCustomers === undefined,
  };
}

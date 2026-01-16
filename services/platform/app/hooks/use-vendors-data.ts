import { useMemo } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { filterByTextSearch, filterByFields, sortByString } from '@/lib/utils/client-utils';
import type { SortOrder } from '@/lib/utils/client-utils';

interface UseVendorsDataOptions {
  organizationId: string;
  search?: string;
  source?: string[];
  locale?: string[];
  sortBy?: 'name' | 'email' | '_creationTime';
  sortOrder?: SortOrder;
}

export function useVendorsData({
  organizationId,
  search,
  source = [],
  locale = [],
  sortBy = 'name',
  sortOrder = 'asc',
}: UseVendorsDataOptions) {
  const allVendors = useQuery(api.queries.vendors.getAllVendors, {
    organizationId,
  });

  const processed = useMemo(() => {
    if (!allVendors) return [];

    let result = allVendors;

    if (search) {
      result = filterByTextSearch(result, search, [
        'name',
        'email',
        'externalId',
      ]);
    }

    const filters = [];
    if (source.length > 0) {
      filters.push({
        field: 'source' as const,
        values: new Set(source),
      });
    }
    if (locale.length > 0) {
      filters.push({
        field: 'locale' as const,
        values: new Set(locale),
      });
    }

    if (filters.length > 0) {
      result = filterByFields(result, filters);
    }

    return [...result].sort(sortByString(sortBy, sortOrder));
  }, [allVendors, search, source, locale, sortBy, sortOrder]);

  return {
    data: processed,
    totalCount: allVendors?.length ?? 0,
    filteredCount: processed.length,
    isLoading: allVendors === undefined,
  };
}

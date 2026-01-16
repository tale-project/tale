import { useMemo } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { filterByTextSearch, filterByFields, sortByString } from '@/lib/utils/client-utils';
import type { SortOrder } from '@/lib/utils/client-utils';

interface UseWebsitesDataOptions {
  organizationId: string;
  search?: string;
  status?: string[];
  sortBy?: 'domain' | 'title' | '_creationTime' | 'lastScannedAt';
  sortOrder?: SortOrder;
}

export function useWebsitesData({
  organizationId,
  search,
  status = [],
  sortBy = 'domain',
  sortOrder = 'asc',
}: UseWebsitesDataOptions) {
  const allWebsites = useQuery(api.queries.websites.getAllWebsites, {
    organizationId,
  });

  const processed = useMemo(() => {
    if (!allWebsites) return [];

    let result = allWebsites;

    if (search) {
      result = filterByTextSearch(result, search, [
        'domain',
        'title',
        'description',
      ]);
    }

    const filters = [];
    if (status.length > 0) {
      filters.push({
        field: 'status' as const,
        values: new Set(status),
      });
    }

    if (filters.length > 0) {
      result = filterByFields(result, filters);
    }

    return [...result].sort(sortByString(sortBy, sortOrder));
  }, [allWebsites, search, status, sortBy, sortOrder]);

  return {
    data: processed,
    totalCount: allWebsites?.length ?? 0,
    filteredCount: processed.length,
    isLoading: allWebsites === undefined,
  };
}

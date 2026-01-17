import { api } from '@/convex/_generated/api';
import { createEntityDataHook } from './use-entity-data-factory';
import type { SortOrder } from '@/lib/utils/client-utils';

type WebsiteSortBy = 'domain' | 'title' | '_creationTime' | 'lastScannedAt';

interface WebsiteFilters {
  status: string[];
}

const useWebsitesDataBase = createEntityDataHook({
  queryFn: api.queries.websites.getAllWebsites,
  searchFields: ['domain', 'title', 'description'],
  sortConfig: {
    string: ['domain', 'title'] as WebsiteSortBy[],
    date: ['_creationTime', 'lastScannedAt'] as WebsiteSortBy[],
    number: [] as WebsiteSortBy[],
  },
  defaultSort: { field: 'domain' as WebsiteSortBy, order: 'asc' as SortOrder },
});

interface UseWebsitesDataOptions {
  organizationId: string;
  search?: string;
  status?: string[];
  sortBy?: WebsiteSortBy;
  sortOrder?: SortOrder;
}

export function useWebsitesData(options: UseWebsitesDataOptions) {
  const { status = [], ...rest } = options;

  return useWebsitesDataBase({
    ...rest,
    filters: { status } as WebsiteFilters,
  });
}

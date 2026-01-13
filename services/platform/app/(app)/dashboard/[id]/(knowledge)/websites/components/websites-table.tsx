'use client';

import { useMemo } from 'react';
import { type Preloaded } from 'convex/react';
import { Globe } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { Doc } from '@/convex/_generated/dataModel';
import { DataTable } from '@/components/ui/data-table/data-table';
import { WebsitesActionMenu } from './websites-action-menu';
import { useWebsitesTableConfig } from '../hooks/use-websites-table-config';
import { useT } from '@/lib/i18n/client';
import { useUrlFilters } from '@/hooks/use-url-filters';
import { useCursorPaginatedQuery } from '@/hooks/use-cursor-paginated-query';
import { websiteFilterDefinitions } from '../filter-definitions';

export interface WebsitesTableProps {
  organizationId: string;
  preloadedWebsites: Preloaded<typeof api.websites.getWebsites>;
}

export function WebsitesTable({
  organizationId,
  preloadedWebsites,
}: WebsitesTableProps) {
  const { t: tTables } = useT('tables');
  const { t: tEmpty } = useT('emptyStates');
  const { t: tWebsites } = useT('websites');

  // Use shared table config
  const { columns, searchPlaceholder, stickyLayout, pageSize } = useWebsitesTableConfig();

  // Use unified URL filters hook (no pagination/sorting needed for cursor-based)
  const {
    filters: filterValues,
    setFilter,
    clearAll,
    isPending,
  } = useUrlFilters({
    filters: websiteFilterDefinitions,
  });

  // Build query args for cursor-based pagination
  const queryArgs = useMemo(
    () => ({
      organizationId,
      searchTerm: filterValues.query || undefined,
      status: filterValues.status.length > 0 ? filterValues.status : undefined,
    }),
    [organizationId, filterValues],
  );

  // Use cursor-based paginated query with SSR + real-time updates
  const { data: websites, error, isLoadingMore, hasMore, loadMore, refetch } = useCursorPaginatedQuery({
    query: api.websites.getWebsites,
    preloadedData: preloadedWebsites,
    args: queryArgs,
    numItems: pageSize,
    // Transform args to wrap cursor/numItems into paginationOpts format
    transformArgs: (baseArgs, cursor, numItems) => ({
      ...baseArgs,
      paginationOpts: { cursor, numItems },
    }),
  });

  // Build filter configs for DataTableFilters component
  const filterConfigs = useMemo(
    () => [
      {
        key: 'status',
        title: tTables('headers.status'),
        options: [
          { value: 'active', label: tWebsites('filter.status.active') },
          { value: 'scanning', label: tWebsites('filter.status.scanning') },
          { value: 'error', label: tWebsites('filter.status.error') },
        ],
        selectedValues: filterValues.status,
        onChange: (values: string[]) => setFilter('status', values),
      },
    ],
    [filterValues, setFilter, tTables, tWebsites],
  );

  return (
    <DataTable
      columns={columns}
      data={websites as Doc<'websites'>[]}
      error={error}
      onRetry={refetch}
      getRowId={(row) => row._id}
      stickyLayout={stickyLayout}
      search={{
        value: filterValues.query,
        onChange: (value) => setFilter('query', value),
        placeholder: searchPlaceholder,
      }}
      filters={filterConfigs}
      isFiltersLoading={isPending}
      onClearFilters={clearAll}
      actionMenu={<WebsitesActionMenu organizationId={organizationId} />}
      emptyState={{
        icon: Globe,
        title: tEmpty('websites.title'),
        description: tEmpty('websites.description'),
      }}
      infiniteScroll={{
        hasMore,
        onLoadMore: loadMore,
        isLoadingMore,
      }}
    />
  );
}

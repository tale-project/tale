'use client';

import { useMemo } from 'react';
import { type Preloaded } from 'convex/react';
import { Globe } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { DataTable } from '@/components/ui/data-table';
import { WebsitesActionMenu } from './websites-action-menu';
import { useWebsitesTableConfig } from '../hooks/use-websites-table-config';
import { useT } from '@/lib/i18n';
import { useUrlFilters } from '@/hooks/use-url-filters';
import { useOffsetPaginatedQuery } from '@/hooks/use-offset-paginated-query';
import { websiteFilterDefinitions } from '../filter-definitions';

export interface WebsitesTableProps {
  organizationId: string;
  preloadedWebsites: Preloaded<typeof api.websites.listWebsites>;
}

export function WebsitesTable({
  organizationId,
  preloadedWebsites,
}: WebsitesTableProps) {
  const { t: tTables } = useT('tables');
  const { t: tEmpty } = useT('emptyStates');
  const { t: tWebsites } = useT('websites');

  // Use shared table config
  const { columns, searchPlaceholder, stickyLayout, pageSize, defaultSort, defaultSortDesc } = useWebsitesTableConfig();

  // Use unified URL filters hook with sorting
  const {
    filters: filterValues,
    sorting,
    setSorting,
    pagination,
    setFilter,
    setPage,
    setPageSize,
    clearAll,
    hasActiveFilters,
    isPending,
  } = useUrlFilters({
    filters: websiteFilterDefinitions,
    pagination: { defaultPageSize: pageSize },
    sorting: { defaultSort, defaultDesc: defaultSortDesc },
  });

  // Use paginated query with SSR + real-time updates
  const { data } = useOffsetPaginatedQuery({
    query: api.websites.listWebsites,
    preloadedData: preloadedWebsites,
    organizationId,
    filters: {
      filters: filterValues,
      sorting,
      pagination,
      setFilter,
      setSorting,
      setPage,
      setPageSize,
      clearAll,
      hasActiveFilters,
      isPending,
      definitions: websiteFilterDefinitions,
    },
    transformFilters: (f) => ({
      searchTerm: f.query || undefined,
      status: f.status.length > 0 ? f.status : undefined,
      sortField: sorting[0]?.id,
      sortOrder: sorting[0] ? (sorting[0].desc ? 'desc' as const : 'asc' as const) : undefined,
    }),
  });

  const websites = data?.items ?? [];

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
      data={websites}
      getRowId={(row) => row._id}
      stickyLayout={stickyLayout}
      sorting={{
        initialSorting: sorting,
        onSortingChange: setSorting,
      }}
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
      pagination={{
        total: data?.total ?? 0,
        pageSize: pagination.pageSize,
        totalPages: data?.totalPages ?? 1,
        hasNextPage: data?.hasNextPage ?? false,
        hasPreviousPage: data?.hasPreviousPage ?? false,
        onPageChange: setPage,
        onPageSizeChange: setPageSize,
        clientSide: false,
      }}
      currentPage={pagination.page}
    />
  );
}

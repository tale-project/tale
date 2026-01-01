'use client';

import { useMemo } from 'react';
import { type Preloaded } from 'convex/react';
import { Loader, Globe } from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';
import { api } from '@/convex/_generated/api';
import type { Doc } from '@/convex/_generated/dataModel';
import { DataTable } from '@/components/ui/data-table';
import { HStack } from '@/components/ui/layout';
import { WebsiteIcon } from '@/components/ui/icons';
import { TableDateCell } from '@/components/ui/table-date-cell';
import { WebsiteRowActions } from './website-row-actions';
import { WebsitesActionMenu } from './websites-action-menu';
import { useT } from '@/lib/i18n';
import { useUrlFilters } from '@/hooks/use-url-filters';
import { useOffsetPaginatedQuery } from '@/hooks/use-offset-paginated-query';
import { websiteFilterDefinitions } from './filter-definitions';

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
    pagination: { defaultPageSize: 10 },
    sorting: { defaultSort: '_creationTime', defaultDesc: true },
  });

  // Use paginated query with SSR + real-time updates
  const { data, isLoading } = useOffsetPaginatedQuery({
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

  // Define columns using TanStack Table
  const columns = useMemo<ColumnDef<Doc<'websites'>>[]>(
    () => [
      {
        accessorKey: 'domain',
        header: tTables('headers.website'),
        size: 256,
        cell: ({ row }) => (
          <HStack gap={2}>
            <div className="flex-shrink-0 size-5 rounded flex items-center justify-center bg-muted">
              <WebsiteIcon className="size-3 text-muted-foreground" />
            </div>
            <span className="font-medium text-sm text-foreground truncate">
              {row.original.domain}
            </span>
          </HStack>
        ),
      },
      {
        accessorKey: 'title',
        header: tTables('headers.title'),
        size: 192,
        cell: ({ row }) => (
          <span className="text-sm text-foreground truncate">
            {row.original.title || tTables('cells.empty')}
          </span>
        ),
      },
      {
        accessorKey: 'description',
        header: tTables('headers.description'),
        size: 256,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground truncate">
            {row.original.description || tTables('cells.empty')}
          </span>
        ),
      },
      {
        accessorKey: 'lastScannedAt',
        header: tTables('headers.scanned'),
        size: 128,
        cell: ({ row }) =>
          row.original.lastScannedAt ? (
            <TableDateCell date={row.original.lastScannedAt} preset="short" className="text-xs" />
          ) : (
            <Loader className="size-4 animate-spin text-muted-foreground" />
          ),
      },
      {
        accessorKey: 'scanInterval',
        header: tTables('headers.interval'),
        size: 96,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.scanInterval}
          </span>
        ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{tTables('headers.actions')}</span>,
        size: 128,
        cell: ({ row }) => (
          <HStack justify="end">
            <WebsiteRowActions website={row.original} />
          </HStack>
        ),
      },
    ],
    [tTables],
  );

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
      isLoading={isLoading}
      stickyLayout
      sorting={{
        initialSorting: sorting,
        onSortingChange: setSorting,
      }}
      search={{
        value: filterValues.query,
        onChange: (value) => setFilter('query', value),
        placeholder: tWebsites('searchPlaceholder'),
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

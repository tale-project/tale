'use client';

import { useState, useMemo } from 'react';
import { type Preloaded } from 'convex/react';
import { Loader, Globe } from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';
import { api } from '@/convex/_generated/api';
import type { Doc } from '@/convex/_generated/dataModel';
import { DataTable, DataTableEmptyState } from '@/components/ui/data-table';
import { DataTableFilters } from '@/components/ui/data-table/data-table-filters';
import { WebsiteIcon } from '@/components/ui/icons';
import { formatDate } from '@/lib/utils/date/format';
import WebsiteRowActions from './website-row-actions';
import AddWebsiteDialog from './add-website-dialog';
import AddWebsiteButton from './add-website-button';
import { useT, useLocale } from '@/lib/i18n';
import { useUrlFilters } from '@/hooks/use-url-filters';
import { useOffsetPaginatedQuery } from '@/hooks/use-offset-paginated-query';
import { websiteFilterDefinitions } from './filter-definitions';

export interface WebsitesTableProps {
  organizationId: string;
  preloadedWebsites: Preloaded<typeof api.websites.listWebsites>;
}

export default function WebsitesTable({
  organizationId,
  preloadedWebsites,
}: WebsitesTableProps) {
  const { t: tTables } = useT('tables');
  const { t: tEmpty } = useT('emptyStates');
  const { t: tWebsites } = useT('websites');
  const locale = useLocale();

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

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
  const emptyWebsites = websites.length === 0 && !hasActiveFilters;

  // Define columns using TanStack Table
  const columns = useMemo<ColumnDef<Doc<'websites'>>[]>(
    () => [
      {
        accessorKey: 'domain',
        header: tTables('headers.website'),
        size: 256,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <div className="flex-shrink-0 size-5 rounded flex items-center justify-center bg-muted">
              <WebsiteIcon className="size-3 text-muted-foreground" />
            </div>
            <span className="font-medium text-sm text-foreground truncate">
              {row.original.domain}
            </span>
          </div>
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
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.lastScannedAt ? (
              formatDate(new Date(row.original.lastScannedAt), {
                preset: 'short',
                locale,
              })
            ) : (
              <Loader className="size-4 animate-spin text-muted-foreground" />
            )}
          </span>
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
          <div className="flex items-center justify-end">
            <WebsiteRowActions website={row.original} />
          </div>
        ),
      },
    ],
    [tTables, locale],
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

  // Show empty state when no websites and no filters
  if (emptyWebsites) {
    return (
      <>
        <DataTableEmptyState
          icon={Globe}
          title={tEmpty('websites.title')}
          description={tEmpty('websites.description')}
          action={<AddWebsiteButton organizationId={organizationId} />}
        />
        <AddWebsiteDialog
          isOpen={isAddDialogOpen}
          onClose={() => setIsAddDialogOpen(false)}
          organizationId={organizationId}
        />
      </>
    );
  }

  return (
    <>
      <AddWebsiteDialog
        isOpen={isAddDialogOpen}
        onClose={() => setIsAddDialogOpen(false)}
        organizationId={organizationId}
      />
      <DataTable
        columns={columns}
        data={websites}
        getRowId={(row) => row._id}
        isLoading={isLoading}
        stickyLayout
        enableSorting
        initialSorting={sorting}
        onSortingChange={setSorting}
        header={
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <DataTableFilters
              search={{
                value: filterValues.query,
                onChange: (value) => setFilter('query', value),
                placeholder: tWebsites('searchPlaceholder'),
              }}
              filters={filterConfigs}
              isLoading={isPending}
              onClearAll={clearAll}
            />
            <AddWebsiteButton organizationId={organizationId} />
          </div>
        }
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
    </>
  );
}

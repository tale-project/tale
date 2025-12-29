'use client';

import { useMemo, useState, useCallback } from 'react';
import { type Preloaded } from 'convex/react';
import { Store, Plus } from 'lucide-react';
import { startCase } from '@/lib/utils/string';
import { type ColumnDef } from '@tanstack/react-table';
import { api } from '@/convex/_generated/api';
import type { Doc } from '@/convex/_generated/dataModel';
import {
  DataTable,
  DataTableEmptyState,
  DataTableActionMenu,
} from '@/components/ui/data-table';
import { Stack, HStack } from '@/components/ui/layout';
import { LocaleIcon } from '@/components/ui/icons';
import { formatDate } from '@/lib/utils/date/format';
import VendorRowActions from './vendor-row-actions';
import ImportVendorsDialog from './import-vendors-dialog';
import { useT, useLocale } from '@/lib/i18n';
import { useUrlFilters } from '@/hooks/use-url-filters';
import { useOffsetPaginatedQuery } from '@/hooks/use-offset-paginated-query';
import { vendorFilterDefinitions } from './filter-definitions';

export interface VendorsTableProps {
  organizationId: string;
  preloadedVendors: Preloaded<typeof api.vendors.listVendors>;
}

export default function VendorsTable({
  organizationId,
  preloadedVendors,
}: VendorsTableProps) {
  const { t: tVendors } = useT('vendors');
  const { t: tTables } = useT('tables');
  const locale = useLocale();

  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);

  const handleImportClick = useCallback(() => setIsImportDialogOpen(true), []);

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
    filters: vendorFilterDefinitions,
    pagination: { defaultPageSize: 10 },
    sorting: { defaultSort: '_creationTime', defaultDesc: true },
  });

  // Use paginated query with SSR + real-time updates
  const { data, isLoading } = useOffsetPaginatedQuery({
    query: api.vendors.listVendors,
    preloadedData: preloadedVendors,
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
      definitions: vendorFilterDefinitions,
    },
    transformFilters: (f) => ({
      searchTerm: f.query || undefined,
      source: f.source.length > 0 ? f.source : undefined,
      locale: f.locale.length > 0 ? f.locale : undefined,
      sortField: sorting[0]?.id,
      sortOrder: sorting[0] ? (sorting[0].desc ? 'desc' as const : 'asc' as const) : undefined,
    }),
  });

  const vendors = data?.items ?? [];
  const emptyVendors = vendors.length === 0 && !hasActiveFilters;

  // Define columns using TanStack Table
  const columns = useMemo<ColumnDef<Doc<'vendors'>>[]>(
    () => [
      {
        accessorKey: 'name',
        header: tTables('headers.name'),
        size: 408,
        cell: ({ row }) => (
          <Stack gap={1}>
            <span className="font-medium text-sm text-foreground">
              {row.original.name || ''}
            </span>
            <span className="text-xs text-muted-foreground">
              {row.original.email || tTables('cells.noEmail')}
            </span>
          </Stack>
        ),
      },
      {
        accessorKey: 'source',
        header: tTables('headers.source'),
        size: 140,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.source
              ? startCase(row.original.source.toLowerCase())
              : tTables('cells.unknown')}
          </span>
        ),
      },
      {
        accessorKey: 'locale',
        header: () => <LocaleIcon className="size-4 text-muted-foreground" />,
        size: 100,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.locale
              ? row.original.locale.toUpperCase().slice(0, 2)
              : 'En'}
          </span>
        ),
      },
      {
        accessorKey: '_creationTime',
        header: () => <span className="text-right w-full block">{tTables('headers.created')}</span>,
        size: 140,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground text-right block">
            {formatDate(new Date(row.original._creationTime), {
              preset: 'short',
              locale,
            })}
          </span>
        ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{tTables('headers.actions')}</span>,
        size: 140,
        cell: ({ row }) => (
          <HStack justify="end">
            <VendorRowActions vendor={row.original} />
          </HStack>
        ),
      },
    ],
    [tTables, locale],
  );

  // Build filter configs for DataTableFilters component
  const filterConfigs = useMemo(
    () => [
      {
        key: 'source',
        title: tTables('headers.source'),
        options: [
          { value: 'manual_import', label: tVendors('filter.source.manual') },
          { value: 'file_upload', label: tVendors('filter.source.upload') },
          { value: 'circuly', label: tVendors('filter.source.circuly') },
        ],
        selectedValues: filterValues.source,
        onChange: (values: string[]) => setFilter('source', values),
      },
      {
        key: 'locale',
        title: tTables('headers.locale'),
        options: [
          { value: 'en', label: 'EN' },
          { value: 'es', label: 'ES' },
          { value: 'fr', label: 'FR' },
          { value: 'de', label: 'DE' },
          { value: 'it', label: 'IT' },
          { value: 'pt', label: 'PT' },
          { value: 'nl', label: 'NL' },
          { value: 'zh', label: 'ZH' },
        ],
        selectedValues: filterValues.locale,
        onChange: (values: string[]) => setFilter('locale', values),
        grid: true,
      },
    ],
    [filterValues, setFilter, tTables, tVendors],
  );

  // Show empty state when no vendors and no filters
  if (emptyVendors) {
    return (
      <>
        <DataTableEmptyState
          icon={Store}
          title={tVendors('noVendorsYet')}
          description={tVendors('uploadFirstVendor')}
          actionMenu={
            <DataTableActionMenu
              label={tVendors('importMenu.importVendors')}
              icon={Plus}
              onClick={handleImportClick}
            />
          }
        />
        <ImportVendorsDialog
          isOpen={isImportDialogOpen}
          onClose={() => setIsImportDialogOpen(false)}
          organizationId={organizationId}
        />
      </>
    );
  }

  return (
    <>
      <ImportVendorsDialog
        isOpen={isImportDialogOpen}
        onClose={() => setIsImportDialogOpen(false)}
        organizationId={organizationId}
      />
      <DataTable
        columns={columns}
        data={vendors}
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
          placeholder: tVendors('searchPlaceholder'),
        }}
        filters={filterConfigs}
        isFiltersLoading={isPending}
        onClearFilters={clearAll}
        actionMenu={
          <DataTableActionMenu
            label={tVendors('importMenu.importVendors')}
            icon={Plus}
            onClick={handleImportClick}
          />
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

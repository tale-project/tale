'use client';

import { useMemo } from 'react';
import { type Preloaded } from 'convex/react';
import { Store } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { DataTable } from '@/components/ui/data-table';
import { VendorsActionMenu } from './vendors-action-menu';
import { useVendorsTableConfig } from '../hooks/use-vendors-table-config';
import { useT } from '@/lib/i18n';
import { useUrlFilters } from '@/hooks/use-url-filters';
import { useOffsetPaginatedQuery } from '@/hooks/use-offset-paginated-query';
import { vendorFilterDefinitions } from '../filter-definitions';

export interface VendorsTableProps {
  organizationId: string;
  preloadedVendors: Preloaded<typeof api.vendors.listVendors>;
}

export function VendorsTable({
  organizationId,
  preloadedVendors,
}: VendorsTableProps) {
  const { t: tVendors } = useT('vendors');
  const { t: tTables } = useT('tables');
  const { t: tGlobal } = useT('global');

  // Use shared table config
  const { columns, searchPlaceholder, stickyLayout, pageSize, defaultSort, defaultSortDesc } = useVendorsTableConfig();

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
    pagination: { defaultPageSize: pageSize },
    sorting: { defaultSort, defaultDesc: defaultSortDesc },
  });

  // Use paginated query with SSR + real-time updates
  const { data } = useOffsetPaginatedQuery({
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
          { value: 'en', label: tGlobal('languageCodes.en') },
          { value: 'es', label: tGlobal('languageCodes.es') },
          { value: 'fr', label: tGlobal('languageCodes.fr') },
          { value: 'de', label: tGlobal('languageCodes.de') },
          { value: 'it', label: tGlobal('languageCodes.it') },
          { value: 'pt', label: tGlobal('languageCodes.pt') },
          { value: 'nl', label: tGlobal('languageCodes.nl') },
          { value: 'zh', label: tGlobal('languageCodes.zh') },
        ],
        selectedValues: filterValues.locale,
        onChange: (values: string[]) => setFilter('locale', values),
        grid: true,
      },
    ],
    [filterValues, setFilter, tTables, tVendors, tGlobal],
  );

  return (
    <DataTable
      columns={columns}
      data={vendors}
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
      actionMenu={<VendorsActionMenu organizationId={organizationId} />}
      emptyState={{
        icon: Store,
        title: tVendors('noVendorsYet'),
        description: tVendors('uploadFirstVendor'),
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

'use client';

import { useMemo } from 'react';
import { type Preloaded } from 'convex/react';
import { Users } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import {
  DataTable,
  useDataTable,
} from '@/components/ui/data-table';
import { CustomersActionMenu } from './customers-action-menu';
import { useCustomersTableConfig } from './use-customers-table-config';
import { useT } from '@/lib/i18n';
import { useUrlFilters } from '@/hooks/use-url-filters';
import { useOffsetPaginatedQuery } from '@/hooks/use-offset-paginated-query';
import { customerFilterDefinitions } from './filter-definitions';

export interface CustomersTableProps {
  organizationId: string;
  preloadedCustomers: Preloaded<typeof api.customers.listCustomers>;
}

export function CustomersTable({
  organizationId,
  preloadedCustomers,
}: CustomersTableProps) {
  const { t: tTables } = useT('tables');
  const { t: tEmpty } = useT('emptyStates');
  const { t: tCustomers } = useT('customers');

  // Use shared table config
  const { columns, searchPlaceholder, stickyLayout, pageSize, defaultSort, defaultSortDesc } = useCustomersTableConfig();

  // Use unified URL filters hook with sorting
  const urlFilters = useUrlFilters({
    filters: customerFilterDefinitions,
    pagination: { defaultPageSize: pageSize },
    sorting: { defaultSort, defaultDesc: defaultSortDesc },
  });

  const { filters: filterValues, sorting, pagination, setPage, setPageSize } = urlFilters;

  // Use the useDataTable hook for search and sorting configs
  const { searchConfig, sortingConfig, clearAll, isPending } = useDataTable({
    urlFilters,
    search: { placeholder: searchPlaceholder },
  });

  // Build filter configs with proper translations
  const filterConfigs = useMemo(
    () => [
      {
        key: 'status',
        title: tTables('headers.status'),
        options: [
          { value: 'active', label: tCustomers('filter.status.active') },
          { value: 'potential', label: tCustomers('filter.status.potential') },
          { value: 'churned', label: tCustomers('filter.status.churned') },
          { value: 'lost', label: tCustomers('filter.status.lost') },
        ],
        selectedValues: filterValues.status,
        onChange: (values: string[]) => urlFilters.setFilter('status', values),
      },
      {
        key: 'source',
        title: tTables('headers.source'),
        options: [
          { value: 'manual_import', label: tCustomers('filter.source.manual') },
          { value: 'file_upload', label: tCustomers('filter.source.upload') },
          { value: 'circuly', label: tCustomers('filter.source.circuly') },
        ],
        selectedValues: filterValues.source,
        onChange: (values: string[]) => urlFilters.setFilter('source', values),
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
        onChange: (values: string[]) => urlFilters.setFilter('locale', values),
        grid: true,
      },
    ],
    [filterValues, urlFilters, tTables, tCustomers],
  );

  // Use paginated query with SSR + real-time updates
  const { data } = useOffsetPaginatedQuery({
    query: api.customers.listCustomers,
    preloadedData: preloadedCustomers,
    organizationId,
    filters: {
      ...urlFilters,
      definitions: customerFilterDefinitions,
    },
    transformFilters: (f) => ({
      searchTerm: f.query || undefined,
      status: f.status.length > 0 ? (f.status as Array<'active' | 'churned' | 'potential'>) : undefined,
      source: f.source.length > 0 ? f.source : undefined,
      locale: f.locale.length > 0 ? f.locale : undefined,
      sortField: sorting[0]?.id,
      sortOrder: sorting[0] ? (sorting[0].desc ? 'desc' as const : 'asc' as const) : undefined,
    }),
  });

  const customers = data?.items ?? [];

  return (
    <DataTable
      columns={columns}
      data={customers}
      getRowId={(row) => row._id}
      stickyLayout={stickyLayout}
      sorting={sortingConfig}
      search={searchConfig}
      filters={filterConfigs}
      isFiltersLoading={isPending}
      onClearFilters={clearAll}
      actionMenu={<CustomersActionMenu organizationId={organizationId} />}
      emptyState={{
        icon: Users,
        title: tEmpty('customers.title'),
        description: tEmpty('customers.description'),
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

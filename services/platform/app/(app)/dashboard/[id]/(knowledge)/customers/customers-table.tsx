'use client';

import { useMemo } from 'react';
import { type Preloaded } from 'convex/react';
import { Users } from 'lucide-react';
import { startCase } from '@/lib/utils/string';
import { type ColumnDef } from '@tanstack/react-table';
import { api } from '@/convex/_generated/api';
import type { Doc } from '@/convex/_generated/dataModel';
import { DataTable, DataTableEmptyState } from '@/components/ui/data-table';
import { DataTableFilters } from '@/components/ui/data-table/data-table-filters';
import { LocaleIcon } from '@/components/ui/icons';
import { CustomerStatusBadge } from '@/components/customers/customer-status-badge';
import { formatDate } from '@/lib/utils/date/format';
import CustomerRowActions from './customer-row-actions';
import ImportCustomersMenu from './import-customers-menu';
import { useT, useLocale } from '@/lib/i18n';
import { useUrlFilters } from '@/hooks/use-url-filters';
import { useOffsetPaginatedQuery } from '@/hooks/use-offset-paginated-query';
import { customerFilterDefinitions } from './filter-definitions';

export interface CustomersTableProps {
  organizationId: string;
  preloadedCustomers: Preloaded<typeof api.customers.listCustomers>;
}

export default function CustomersTable({
  organizationId,
  preloadedCustomers,
}: CustomersTableProps) {
  const { t: tTables } = useT('tables');
  const { t: tEmpty } = useT('emptyStates');
  const { t: tCustomers } = useT('customers');
  const locale = useLocale();

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
    filters: customerFilterDefinitions,
    pagination: { defaultPageSize: 10 },
    sorting: { defaultSort: '_creationTime', defaultDesc: true },
  });

  // Use paginated query with SSR + real-time updates
  const { data, isLoading } = useOffsetPaginatedQuery({
    query: api.customers.listCustomers,
    preloadedData: preloadedCustomers,
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
      definitions: customerFilterDefinitions,
    },
    transformFilters: (f) => ({
      searchTerm: f.query || undefined,
      // Cast status to the expected type
      status: f.status.length > 0 ? (f.status as Array<'active' | 'churned' | 'potential'>) : undefined,
      source: f.source.length > 0 ? f.source : undefined,
      locale: f.locale.length > 0 ? f.locale : undefined,
      sortField: sorting[0]?.id,
      sortOrder: sorting[0] ? (sorting[0].desc ? 'desc' as const : 'asc' as const) : undefined,
    }),
  });

  const customers = data?.items ?? [];
  const emptyCustomers = customers.length === 0 && !hasActiveFilters;

  // Define columns using TanStack Table
  const columns = useMemo<ColumnDef<Doc<'customers'>>[]>(
    () => [
      {
        accessorKey: 'name',
        header: tTables('headers.name'),
        size: 278,
        cell: ({ row }) => (
          <div className="flex flex-col gap-1">
            <span className="font-medium text-sm text-foreground">
              {row.original.name || ''}
            </span>
            <span className="text-xs text-muted-foreground">
              {row.original.email || tTables('cells.noEmail')}
            </span>
          </div>
        ),
      },
      {
        accessorKey: 'status',
        header: tTables('headers.status'),
        size: 140,
        cell: ({ row }) => <CustomerStatusBadge status={row.original.status} />,
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
            {row.original.locale || 'en'}
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
          <div className="flex items-center justify-end">
            <CustomerRowActions customer={row.original} />
          </div>
        ),
      },
    ],
    [tTables, locale],
  );

  // Build filter configs for DataTableFilters component
  // Note: Status labels are capitalized directly (matching original behavior)
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
        onChange: (values: string[]) => setFilter('status', values),
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
    [filterValues, setFilter, tTables, tCustomers],
  );

  // Show empty state when no customers and no filters
  if (emptyCustomers) {
    return (
      <DataTableEmptyState
        icon={Users}
        title={tEmpty('customers.title')}
        description={tEmpty('customers.description')}
        action={<ImportCustomersMenu organizationId={organizationId} />}
      />
    );
  }

  return (
    <DataTable
      columns={columns}
      data={customers}
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
              placeholder: tCustomers('searchPlaceholder'),
            }}
            filters={filterConfigs}
            isLoading={isPending}
            onClearAll={clearAll}
          />
          <ImportCustomersMenu organizationId={organizationId} />
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
  );
}

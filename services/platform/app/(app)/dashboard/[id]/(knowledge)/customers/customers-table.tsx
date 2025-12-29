'use client';

import { useMemo, useState, useCallback } from 'react';
import { type Preloaded } from 'convex/react';
import { Users, Plus } from 'lucide-react';
import { startCase } from '@/lib/utils/string';
import { type ColumnDef } from '@tanstack/react-table';
import { api } from '@/convex/_generated/api';
import type { Doc } from '@/convex/_generated/dataModel';
import {
  DataTable,
  DataTableEmptyState,
  DataTableActionMenu,
  useDataTable,
} from '@/components/ui/data-table';
import { Stack, HStack } from '@/components/ui/layout';
import { LocaleIcon } from '@/components/ui/icons';
import { CustomerStatusBadge } from '@/components/customers/customer-status-badge';
import { formatDate } from '@/lib/utils/date/format';
import CustomerRowActions from './customer-row-actions';
import ImportCustomersDialog from './import-customers-dialog';
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

  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);

  const handleImportClick = useCallback(() => setIsImportDialogOpen(true), []);

  // Use unified URL filters hook with sorting
  const urlFilters = useUrlFilters({
    filters: customerFilterDefinitions,
    pagination: { defaultPageSize: 10 },
    sorting: { defaultSort: '_creationTime', defaultDesc: true },
  });

  const { filters: filterValues, sorting, pagination, setPage, setPageSize } = urlFilters;

  // Use the new useDataTable hook for search, filter, and sorting configs
  const { searchConfig, filterConfigs, sortingConfig, hasActiveFilters, clearAll, isPending } = useDataTable({
    urlFilters,
    t: (key) => {
      // Route translation keys to appropriate namespaces
      if (key.startsWith('tables.')) return tTables(key.replace('tables.', '') as 'headers.status');
      if (key.startsWith('customers.')) return tCustomers(key.replace('customers.', '') as 'filter.status.active');
      if (key.startsWith('locales.')) return key.replace('locales.', '').toUpperCase();
      return key;
    },
    search: { placeholder: tCustomers('searchPlaceholder') },
  });

  // Use paginated query with SSR + real-time updates
  const { data, isLoading } = useOffsetPaginatedQuery({
    query: api.customers.listCustomers,
    preloadedData: preloadedCustomers,
    organizationId,
    filters: {
      ...urlFilters,
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
          <HStack justify="end">
            <CustomerRowActions customer={row.original} />
          </HStack>
        ),
      },
    ],
    [tTables, locale],
  );

  // Show empty state when no customers and no filters
  if (emptyCustomers) {
    return (
      <>
        <DataTableEmptyState
          icon={Users}
          title={tEmpty('customers.title')}
          description={tEmpty('customers.description')}
          actionMenu={
            <DataTableActionMenu
              label={tCustomers('importMenu.importCustomers')}
              icon={Plus}
              onClick={handleImportClick}
            />
          }
        />
        <ImportCustomersDialog
          isOpen={isImportDialogOpen}
          onClose={() => setIsImportDialogOpen(false)}
          organizationId={organizationId}
        />
      </>
    );
  }

  return (
    <>
      <ImportCustomersDialog
        isOpen={isImportDialogOpen}
        onClose={() => setIsImportDialogOpen(false)}
        organizationId={organizationId}
      />
      <DataTable
        columns={columns}
        data={customers}
        getRowId={(row) => row._id}
        isLoading={isLoading}
        stickyLayout
        sorting={sortingConfig}
        search={searchConfig}
        filters={filterConfigs}
        isFiltersLoading={isPending}
        onClearFilters={clearAll}
        actionMenu={
          <DataTableActionMenu
            label={tCustomers('importMenu.importCustomers')}
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

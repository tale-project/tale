'use client';

import { useMemo } from 'react';
import { usePreloadedQuery, type Preloaded } from 'convex/react';
import { useSearchParams } from 'next/navigation';
import { Users } from 'lucide-react';
import { startCase } from '@/lib/utils/string';
import { type ColumnDef } from '@tanstack/react-table';
import { api } from '@/convex/_generated/api';
import type { Doc } from '@/convex/_generated/dataModel';
import { DataTable, DataTableEmptyState } from '@/components/ui/data-table';
import { LocaleIcon } from '@/components/ui/icons';
import { CustomerStatusBadge } from '@/components/customers/customer-status-badge';
import { formatDate } from '@/lib/utils/date/format';
import CustomerRowActions from './customer-row-actions';
import CustomerFilter from './customer-filter';
import CustomerSearch from './customer-search';
import ImportCustomersMenu from './import-customers-menu';
import { useT, useLocale } from '@/lib/i18n';

export interface CustomersTableProps {
  organizationId: string;
  currentPage?: number;
  pageSize?: number;
  searchTerm?: string;
  preloadedCustomers: Preloaded<typeof api.customers.getCustomers>;
}

export default function CustomersTable({
  organizationId,
  currentPage = 1,
  pageSize = 10,
  searchTerm,
  preloadedCustomers,
}: CustomersTableProps) {
  const { t: tTables } = useT('tables');
  const { t: tEmpty } = useT('emptyStates');
  const locale = useLocale();

  const searchParams = useSearchParams();

  // Memoize filter parsing to avoid string operations on every render
  const { statusFilters, sourceFilters, localeFilters, hasActiveFilters } =
    useMemo(() => {
      const status = searchParams.get('status')?.split(',').filter(Boolean);
      const source = searchParams.get('source')?.split(',').filter(Boolean);
      const locale = searchParams.get('locale')?.split(',').filter(Boolean);

      return {
        statusFilters: status,
        sourceFilters: source,
        localeFilters: locale,
        hasActiveFilters:
          searchTerm ||
          (status && status.length > 0) ||
          (source && source.length > 0) ||
          (locale && locale.length > 0),
      };
    }, [searchParams, searchTerm]);

  // Use preloaded query for SSR + real-time reactivity
  const result = usePreloadedQuery(preloadedCustomers);
  const customers = result.page;
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
    [tTables],
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
      header={
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <CustomerSearch currentSearch={searchTerm} />
            <CustomerFilter />
          </div>
          <ImportCustomersMenu organizationId={organizationId} />
        </div>
      }
      pagination={{
        total: customers.length,
        pageSize,
        totalPages: Math.ceil(customers.length / pageSize),
        clientSide: true,
      }}
      currentPage={currentPage}
    />
  );
}

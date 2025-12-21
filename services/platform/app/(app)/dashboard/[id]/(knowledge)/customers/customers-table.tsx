'use client';

import { useMemo } from 'react';
import { usePreloadedQuery, type Preloaded } from 'convex/react';
import { useSearchParams } from 'next/navigation';
import { Users } from 'lucide-react';
import { startCase } from 'lodash';
import { type ColumnDef } from '@tanstack/react-table';
import { api } from '@/convex/_generated/api';
import type { Doc } from '@/convex/_generated/dataModel';
import { DataTable, DataTableEmptyState } from '@/components/ui/data-table';
import { CustomerStatusBadge } from '@/components/customers/customer-status-badge';
import { formatDate } from '@/lib/utils/date/format';
import CustomerRowActions from './customer-row-actions';
import CustomerFilter from './customer-filter';
import CustomerSearch from './customer-search';
import ImportCustomersMenu from './import-customers-menu';

// Locale icon component
const LocaleIcon = () => (
  <svg className="size-4 text-muted-foreground" fill="none" viewBox="0 0 17 17">
    <path
      d="M7.25 16L11.625 6.625L16 16M8.5 13.5H14.75M1 3.18447C2.63797 2.98022 4.3067 2.875 6 2.875M6 2.875C6.93401 2.875 7.86054 2.90701 8.77856 2.97M6 2.875V1M8.77856 2.97C7.81361 7.38151 4.90723 11.0668 1 13.0852M8.77856 2.97C9.52485 3.0212 10.2655 3.09288 11 3.18447M7.17606 10.2635C5.82129 8.88493 4.73087 7.24575 3.98694 5.42805"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
    />
  </svg>
);

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
  const searchParams = useSearchParams();
  const statusFilters = searchParams.get('status')?.split(',').filter(Boolean);
  const sourceFilters = searchParams.get('source')?.split(',').filter(Boolean);
  const localeFilters = searchParams.get('locale')?.split(',').filter(Boolean);

  // Use preloaded query for SSR + real-time reactivity
  const result = usePreloadedQuery(preloadedCustomers);
  const customers = result.items as Doc<'customers'>[];

  const hasActiveFilters =
    searchTerm ||
    (statusFilters && statusFilters.length > 0) ||
    (sourceFilters && sourceFilters.length > 0) ||
    (localeFilters && localeFilters.length > 0);
  const emptyCustomers = customers.length === 0 && !hasActiveFilters;

  // Define columns using TanStack Table
  const columns = useMemo<ColumnDef<Doc<'customers'>>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Name',
        size: 278,
        cell: ({ row }) => (
          <div className="flex flex-col gap-1">
            <span className="font-medium text-sm text-foreground">
              {row.original.name || ''}
            </span>
            <span className="text-xs text-muted-foreground">
              {row.original.email || 'No email'}
            </span>
          </div>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        size: 140,
        cell: ({ row }) => <CustomerStatusBadge status={row.original.status} />,
      },
      {
        accessorKey: 'source',
        header: 'Source',
        size: 140,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.source
              ? startCase(row.original.source.toLowerCase())
              : 'Unknown'}
          </span>
        ),
      },
      {
        accessorKey: 'locale',
        header: () => <LocaleIcon />,
        size: 100,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.locale || 'en'}
          </span>
        ),
      },
      {
        accessorKey: '_creationTime',
        header: () => <span className="text-right w-full block">Created</span>,
        size: 140,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground text-right block">
            {formatDate(new Date(row.original._creationTime), {
              preset: 'short',
            })}
          </span>
        ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        size: 140,
        cell: ({ row }) => (
          <div className="flex items-center justify-end">
            <CustomerRowActions customer={row.original} />
          </div>
        ),
      },
    ],
    [],
  );

  // Show empty state when no customers and no filters
  if (emptyCustomers) {
    return (
      <DataTableEmptyState
        icon={Users}
        title="No customers yet"
        description="Upload your first customer to get started"
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

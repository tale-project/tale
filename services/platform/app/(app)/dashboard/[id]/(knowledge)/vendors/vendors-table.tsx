'use client';

import { useMemo } from 'react';
import { usePreloadedQuery, type Preloaded } from 'convex/react';
import { useSearchParams } from 'next/navigation';
import { Store } from 'lucide-react';
import { startCase } from 'lodash';
import { type ColumnDef } from '@tanstack/react-table';
import { api } from '@/convex/_generated/api';
import type { Doc } from '@/convex/_generated/dataModel';
import { DataTable, DataTableEmptyState } from '@/components/ui/data-table';
import { formatDate } from '@/lib/utils/date/format';
import VendorRowActions from './vendor-row-actions';
import VendorFilter from './vendor-filter';
import VendorSearch from './vendor-search';
import ImportVendorsMenu from './import-vendors-menu';

// Locale icon component
const LocaleIcon = () => (
  <svg className="size-4 text-muted-foreground" fill="none" viewBox="0 0 20 20">
    <path
      d="M7.25 16L11.625 6.625L16 16M8.5 13.5H14.75M1 3.18447C2.63797 2.98022 4.3067 2.875 6 2.875M6 2.875C6.93401 2.875 7.86054 2.90701 8.77856 2.97M6 2.875V1M8.77856 2.97C7.81361 7.38151 4.90723 11.0668 1 13.0852M8.77856 2.97C9.52485 3.0212 10.2655 3.09288 11 3.18447M7.17606 10.2635C5.82129 8.88493 4.73087 7.24575 3.98694 5.42805"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
    />
  </svg>
);

export interface VendorsTableProps {
  organizationId: string;
  currentPage?: number;
  pageSize?: number;
  searchTerm?: string;
  preloadedVendors: Preloaded<typeof api.vendors.getVendors>;
}

export default function VendorsTable({
  organizationId,
  currentPage = 1,
  pageSize = 10,
  searchTerm,
  preloadedVendors,
}: VendorsTableProps) {
  const searchParams = useSearchParams();
  const sourceFilters = searchParams.get('source')?.split(',').filter(Boolean);
  const localeFilters = searchParams.get('locale')?.split(',').filter(Boolean);

  // Use preloaded query for SSR + real-time reactivity
  const result = usePreloadedQuery(preloadedVendors);
  const vendors = result.page;

  const hasActiveFilters =
    searchTerm ||
    (sourceFilters && sourceFilters.length > 0) ||
    (localeFilters && localeFilters.length > 0);
  const emptyVendors = vendors.length === 0 && !hasActiveFilters;

  // Define columns using TanStack Table
  const columns = useMemo<ColumnDef<Doc<'vendors'>>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Name',
        size: 408,
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
            {row.original.locale
              ? row.original.locale.toUpperCase().slice(0, 2)
              : 'En'}
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
            <VendorRowActions vendor={row.original} />
          </div>
        ),
      },
    ],
    [],
  );

  // Show empty state when no vendors and no filters
  if (emptyVendors) {
    return (
      <DataTableEmptyState
        icon={Store}
        title="No vendors yet"
        description="Upload your first vendor to get started"
        action={<ImportVendorsMenu organizationId={organizationId} />}
      />
    );
  }

  return (
    <DataTable
      columns={columns}
      data={vendors}
      getRowId={(row) => row._id}
      header={
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <VendorSearch currentSearch={searchTerm} />
            <VendorFilter />
          </div>
          <ImportVendorsMenu organizationId={organizationId} />
        </div>
      }
      pagination={{
        total: vendors.length,
        pageSize,
        totalPages: Math.ceil(vendors.length / pageSize),
        clientSide: true,
      }}
      currentPage={currentPage}
    />
  );
}

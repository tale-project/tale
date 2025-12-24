'use client';

import { useMemo } from 'react';
import { usePreloadedQuery, type Preloaded } from 'convex/react';
import { useSearchParams } from 'next/navigation';
import { Store } from 'lucide-react';
import { startCase } from '@/lib/utils/string';
import { type ColumnDef } from '@tanstack/react-table';
import { api } from '@/convex/_generated/api';
import type { Doc } from '@/convex/_generated/dataModel';
import { DataTable, DataTableEmptyState } from '@/components/ui/data-table';
import { LocaleIcon } from '@/components/ui/icons';
import { formatDate } from '@/lib/utils/date/format';
import VendorRowActions from './vendor-row-actions';
import VendorFilter from './vendor-filter';
import VendorSearch from './vendor-search';
import ImportVendorsMenu from './import-vendors-menu';
import { useT, useLocale } from '@/lib/i18n';

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
  const { t: tVendors } = useT('vendors');
  const locale = useLocale();
  const searchParams = useSearchParams();

  // Memoize filter parsing to avoid string operations on every render
  const { hasActiveFilters } = useMemo(() => {
    const source = searchParams.get('source')?.split(',').filter(Boolean);
    const locale = searchParams.get('locale')?.split(',').filter(Boolean);

    return {
      hasActiveFilters:
        searchTerm ||
        (source && source.length > 0) ||
        (locale && locale.length > 0),
    };
  }, [searchParams, searchTerm]);

  // Use preloaded query for SSR + real-time reactivity
  const result = usePreloadedQuery(preloadedVendors);
  const vendors = result.page;
  const emptyVendors = vendors.length === 0 && !hasActiveFilters;

  // Define columns using TanStack Table
  const columns = useMemo<ColumnDef<Doc<'vendors'>>[]>(
    () => [
      {
        accessorKey: 'name',
        header: tVendors('name'),
        size: 408,
        cell: ({ row }) => (
          <div className="flex flex-col gap-1">
            <span className="font-medium text-sm text-foreground">
              {row.original.name || ''}
            </span>
            <span className="text-xs text-muted-foreground">
              {row.original.email || tVendors('noEmail')}
            </span>
          </div>
        ),
      },
      {
        accessorKey: 'source',
        header: tVendors('source'),
        size: 140,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.source
              ? startCase(row.original.source.toLowerCase())
              : tVendors('unknown')}
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
        header: () => <span className="text-right w-full block">{tVendors('created')}</span>,
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
        header: () => <span className="sr-only">{tVendors('actions')}</span>,
        size: 140,
        cell: ({ row }) => (
          <div className="flex items-center justify-end">
            <VendorRowActions vendor={row.original} />
          </div>
        ),
      },
    ],
    [tVendors],
  );

  // Show empty state when no vendors and no filters
  if (emptyVendors) {
    return (
      <DataTableEmptyState
        icon={Store}
        title={tVendors('noVendorsYet')}
        description={tVendors('uploadFirstVendor')}
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

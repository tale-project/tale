'use client';

import { useMemo } from 'react';
import { startCase } from '@/lib/utils/string';
import { type ColumnDef } from '@tanstack/react-table';
import type { Doc } from '@/convex/_generated/dataModel';
import { Stack, HStack } from '@/components/ui/layout/layout';
import { LocaleIcon } from '@/components/icons/locale-icon';
import { TableTimestampCell } from '@/components/ui/data-display/table-date-cell';
import { VendorRowActions } from '../components/vendor-row-actions';
import { useT } from '@/lib/i18n/client';

/** Shared table configuration for vendors - used by both table and skeleton */
export function useVendorsTableConfig() {
  const { t: tTables } = useT('tables');
  const { t: tVendors } = useT('vendors');

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
        header: () => (
          <span className="text-right w-full block">
            {tTables('headers.created')}
          </span>
        ),
        size: 140,
        cell: ({ row }) => (
          <TableTimestampCell
            timestamp={row.original._creationTime}
            preset="short"
          />
        ),
      },
      {
        id: 'actions',
        header: () => (
          <span className="sr-only">{tTables('headers.actions')}</span>
        ),
        size: 140,
        meta: { isAction: true },
        cell: ({ row }) => (
          <HStack justify="end">
            <VendorRowActions vendor={row.original} />
          </HStack>
        ),
      },
    ],
    [tTables],
  );

  return {
    columns,
    searchPlaceholder: tVendors('searchPlaceholder'),
    stickyLayout: true as const,
    pageSize: 10,
    defaultSort: '_creationTime' as const,
    defaultSortDesc: true,
    infiniteScroll: true as const,
  };
}

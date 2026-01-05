'use client';

import { useMemo } from 'react';
import { startCase } from '@/lib/utils/string';
import { type ColumnDef } from '@tanstack/react-table';
import type { Doc } from '@/convex/_generated/dataModel';
import { Stack, HStack } from '@/components/ui/layout';
import { LocaleIcon } from '@/components/icons';
import { CustomerStatusBadge } from '../components/customer-status-badge';
import { TableTimestampCell } from '@/components/ui/table-date-cell';
import { CustomerRowActions } from '../components/customer-row-actions';
import { useT } from '@/lib/i18n';

/** Shared table configuration for customers - used by both table and skeleton */
export function useCustomersTableConfig() {
  const { t: tTables } = useT('tables');
  const { t: tCustomers } = useT('customers');

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
            <CustomerRowActions customer={row.original} />
          </HStack>
        ),
      },
    ],
    [tTables],
  );

  return {
    columns,
    searchPlaceholder: tCustomers('searchPlaceholder'),
    stickyLayout: true as const,
    pageSize: 10,
    defaultSort: '_creationTime' as const,
    defaultSortDesc: true,
  };
}

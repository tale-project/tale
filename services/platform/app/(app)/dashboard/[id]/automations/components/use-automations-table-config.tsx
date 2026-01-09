'use client';

import { useMemo, useCallback } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Doc } from '@/convex/_generated/dataModel';
import { HStack } from '@/components/ui/layout';
import { Badge } from '@/components/ui/badge';
import { TableTimestampCell } from '@/components/ui/table-date-cell';
import { AutomationRowActions } from './automation-row-actions';
import { useT } from '@/lib/i18n';

/** Shared table configuration for automations - used by both table and skeleton */
export function useAutomationsTableConfig() {
  const { t: tTables } = useT('tables');
  const { t: tCommon } = useT('common');
  const { t: tAutomations } = useT('automations');

  const getStatusBadge = useCallback(
    (status: string) => (
      <Badge dot variant={status === 'active' ? 'green' : 'outline'}>
        {status === 'active'
          ? tCommon('status.published')
          : tCommon('status.draft')}
      </Badge>
    ),
    [tCommon],
  );

  const columns = useMemo<ColumnDef<Doc<'wfDefinitions'>>[]>(
    () => [
      {
        accessorKey: 'name',
        header: tTables('headers.automation'),
        size: 328,
        cell: ({ row }) => (
          <span className="text-sm font-medium text-foreground truncate px-2">
            {row.original.name}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: tTables('headers.status'),
        size: 140,
        cell: ({ row }) => getStatusBadge(row.original.status),
      },
      {
        accessorKey: 'version',
        header: tTables('headers.version'),
        size: 100,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.version}
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
        size: 80,
        meta: { isAction: true },
        cell: ({ row }) => (
          <HStack justify="end">
            <AutomationRowActions automation={row.original} />
          </HStack>
        ),
      },
    ],
    [getStatusBadge, tTables],
  );

  return {
    columns,
    searchPlaceholder: tAutomations('searchPlaceholder'),
    stickyLayout: true as const,
    pageSize: 10,
    defaultSort: '_creationTime' as const,
    defaultSortDesc: true,
    infiniteScroll: true as const,
  };
}

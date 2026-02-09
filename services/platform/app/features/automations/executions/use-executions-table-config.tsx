'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';

import type { Doc } from '@/convex/_generated/dataModel';

import { useT } from '@/lib/i18n/client';

/** Shared table configuration for executions - used by both table and skeleton */
export function useExecutionsTableConfig() {
  const { t: tTables } = useT('tables');
  const { t: tCommon } = useT('common');

  const columns = useMemo<ColumnDef<Doc<'wfExecutions'>>[]>(
    () => [
      {
        accessorKey: '_id',
        header: tTables('headers.executionId'),
        size: 160,
        meta: { skeleton: { type: 'id-copy' as const } },
      },
      {
        accessorKey: 'status',
        header: tTables('headers.status'),
        size: 128,
        meta: { skeleton: { type: 'badge' as const } },
      },
      {
        accessorKey: 'startedAt',
        header: tTables('headers.startedAt'),
        size: 192,
      },
      {
        id: 'duration',
        header: tTables('headers.duration'),
        size: 128,
      },
      {
        accessorKey: 'triggeredBy',
        header: tTables('headers.triggeredBy'),
        size: 128,
      },
    ],
    [tTables],
  );

  return {
    columns,
    searchPlaceholder: tCommon('search.placeholder'),
    stickyLayout: true as const,
    pageSize: 30,
    defaultSort: 'startedAt' as const,
    defaultSortDesc: true,
    infiniteScroll: true as const,
  };
}

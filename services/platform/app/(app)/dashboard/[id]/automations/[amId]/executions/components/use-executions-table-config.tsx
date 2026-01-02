'use client';

import { useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { useT } from '@/lib/i18n';
import type { Execution } from './executions-table';

/** Shared table configuration for executions - used by both table and skeleton */
export function useExecutionsTableConfig() {
  const { t: tTables } = useT('tables');
  const { t: tCommon } = useT('common');

  const columns = useMemo<ColumnDef<Execution>[]>(
    () => [
      {
        accessorKey: '_id',
        header: tTables('headers.executionId'),
        size: 160,
      },
      {
        accessorKey: 'status',
        header: tTables('headers.status'),
        size: 128,
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
    pageSize: 10,
    defaultSort: 'startedAt' as const,
    defaultSortDesc: true,
  };
}

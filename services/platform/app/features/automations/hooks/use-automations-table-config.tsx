'use client';

import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';

import { Badge } from '@/app/components/ui/feedback/badge';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';

import type { WorkflowListItem } from '../components/automations-table';

export function useAutomationsTableConfig() {
  const { t: tTables } = useT('tables');
  const { t: tCommon } = useT('common');
  const { t: tAutomations } = useT('automations');

  const nameColumn: ColumnDef<WorkflowListItem> = useMemo(
    () => ({
      accessorKey: 'name',
      header: tTables('headers.automation'),
      size: 300,
      meta: { hasAvatar: false },
      cell: ({ row }) => (
        <Text as="span" variant="label" truncate>
          {row.original.name}
        </Text>
      ),
    }),
    [tTables],
  );

  const categoryColumn: ColumnDef<WorkflowListItem> = useMemo(
    () => ({
      id: 'category',
      header: tAutomations('columns.category'),
      size: 120,
      meta: { skeleton: { type: 'badge' } },
      cell: ({ row }) => {
        if (!row.original.category) return null;
        return <Badge variant="outline">{row.original.category}</Badge>;
      },
    }),
    [tAutomations],
  );

  const statusColumn: ColumnDef<WorkflowListItem> = useMemo(
    () => ({
      accessorKey: 'enabled',
      header: tTables('headers.status'),
      size: 120,
      meta: { skeleton: { type: 'badge' } },
      cell: ({ row }) => (
        <Badge dot variant={row.original.enabled ? 'green' : 'outline'}>
          {row.original.enabled
            ? tCommon('status.published')
            : tCommon('status.draft')}
        </Badge>
      ),
    }),
    [tTables, tCommon],
  );

  const versionColumn: ColumnDef<WorkflowListItem> = useMemo(
    () => ({
      accessorKey: 'version',
      header: () => (
        <span className="block w-full text-right">
          {tTables('headers.version')}
        </span>
      ),
      size: 100,
      meta: { headerLabel: tTables('headers.version'), align: 'right' },
      cell: ({ row }) => (
        <Text as="span" variant="caption" className="block text-right">
          {row.original.version}
        </Text>
      ),
    }),
    [tTables],
  );

  const folderColumns = useMemo(
    () => [nameColumn, statusColumn, versionColumn],
    [nameColumn, statusColumn, versionColumn],
  );

  const listColumns = useMemo(
    () => [nameColumn, categoryColumn, statusColumn, versionColumn],
    [nameColumn, categoryColumn, statusColumn, versionColumn],
  );

  return {
    columns: folderColumns,
    listColumns,
    searchPlaceholder: tAutomations('search.placeholder'),
  };
}

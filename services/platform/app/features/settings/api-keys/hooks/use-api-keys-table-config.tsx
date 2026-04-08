'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';

import { TableDateCell } from '@/app/components/ui/data-display/table-date-cell';
import { ActionRow } from '@/app/components/ui/layout/action-row';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';

import { ApiKeyRowActions } from '../components/api-key-row-actions';
import type { ApiKey } from '../types';

interface ApiKeysTableConfig {
  columns: ColumnDef<ApiKey>[];
  searchPlaceholder: string;
  stickyLayout: boolean;
  pageSize: number;
  infiniteScroll: boolean;
}

export function useApiKeysTableConfig(
  organizationId: string,
): ApiKeysTableConfig {
  const { t: tSettings } = useT('settings');

  const columns = useMemo<ColumnDef<ApiKey>[]>(
    () => [
      {
        accessorKey: 'name',
        header: tSettings('apiKeys.columns.name'),
        cell: ({ row }) => (
          <Text as="span" variant="label">
            {row.original.name || '-'}
          </Text>
        ),
      },
      {
        id: 'key',
        header: tSettings('apiKeys.columns.key'),
        cell: ({ row }) => (
          <Text as="span" variant="muted" className="font-mono text-sm">
            {row.original.start || row.original.prefix || '-'}
          </Text>
        ),
      },
      {
        id: 'created',
        header: tSettings('apiKeys.columns.created'),
        size: 140,
        cell: ({ row }) => (
          <TableDateCell date={row.original.createdAt} preset="short" />
        ),
      },
      {
        id: 'lastUsed',
        header: tSettings('apiKeys.columns.lastUsed'),
        size: 140,
        cell: ({ row }) => (
          <TableDateCell
            date={row.original.lastRequest}
            preset="short"
            emptyText={tSettings('apiKeys.neverUsed')}
          />
        ),
      },
      {
        id: 'actions',
        size: 44,
        meta: { isAction: true },
        cell: ({ row }) => (
          <ActionRow justify="end">
            <ApiKeyRowActions
              apiKey={row.original}
              organizationId={organizationId}
            />
          </ActionRow>
        ),
      },
    ],
    [tSettings, organizationId],
  );

  return {
    columns,
    searchPlaceholder: tSettings('apiKeys.searchKeys'),
    stickyLayout: true,
    pageSize: 20,
    infiniteScroll: false,
  };
}

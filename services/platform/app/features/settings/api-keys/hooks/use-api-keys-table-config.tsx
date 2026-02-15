'use client';

import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';

import { TableDateCell } from '@/app/components/ui/data-display/table-date-cell';
import { HStack } from '@/app/components/ui/layout/layout';
import { useT } from '@/lib/i18n/client';

import type { ApiKey } from '../types';

import { ApiKeyRowActions } from '../components/api-key-row-actions';

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
        size: 200,
        cell: ({ row }) => (
          <span className="text-foreground text-sm font-medium">
            {row.original.name || '-'}
          </span>
        ),
      },
      {
        id: 'prefix',
        header: tSettings('apiKeys.columns.prefix'),
        size: 150,
        cell: ({ row }) => (
          <code className="bg-muted rounded px-2 py-1 font-mono text-sm">
            {row.original.start || row.original.prefix || '-'}...
          </code>
        ),
      },
      {
        id: 'created',
        header: () => (
          <span className="block w-full text-right">
            {tSettings('apiKeys.columns.created')}
          </span>
        ),
        size: 150,
        meta: { headerLabel: tSettings('apiKeys.columns.created') },
        cell: ({ row }) => (
          <TableDateCell
            date={row.original.createdAt}
            preset="short"
            alignRight
          />
        ),
      },
      {
        id: 'lastUsed',
        header: () => (
          <span className="block w-full text-right">
            {tSettings('apiKeys.columns.lastUsed')}
          </span>
        ),
        size: 150,
        meta: { headerLabel: tSettings('apiKeys.columns.lastUsed') },
        cell: ({ row }) => (
          <TableDateCell
            date={row.original.lastRequest}
            preset="short"
            alignRight
            emptyText={tSettings('apiKeys.neverUsed')}
          />
        ),
      },
      {
        id: 'expires',
        header: () => (
          <span className="block w-full text-right">
            {tSettings('apiKeys.columns.expires')}
          </span>
        ),
        size: 150,
        meta: { headerLabel: tSettings('apiKeys.columns.expires') },
        cell: ({ row }) => (
          <TableDateCell
            date={row.original.expiresAt}
            preset="short"
            alignRight
            emptyText={tSettings('apiKeys.never')}
          />
        ),
      },
      {
        id: 'actions',
        size: 140,
        meta: { isAction: true },
        cell: ({ row }) => (
          <HStack justify="end">
            <ApiKeyRowActions
              apiKey={row.original}
              organizationId={organizationId}
            />
          </HStack>
        ),
      },
    ],
    [tSettings, organizationId],
  );

  return {
    columns,
    searchPlaceholder: tSettings('apiKeys.searchKeys'),
    stickyLayout: true,
    pageSize: 10,
    infiniteScroll: false,
  };
}

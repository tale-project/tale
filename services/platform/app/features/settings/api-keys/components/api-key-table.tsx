'use client';

import type { ColumnDef } from '@tanstack/react-table';

import { Key } from 'lucide-react';
import { useMemo } from 'react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { HStack } from '@/app/components/ui/layout/layout';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';

import type { ApiKey } from '../types';

import { ApiKeyRowActions } from './api-key-row-actions';

interface ApiKeyTableProps {
  apiKeys: ApiKey[];
  isLoading: boolean;
  organizationId: string;
}

export function ApiKeyTable({
  apiKeys,
  isLoading,
  organizationId,
}: ApiKeyTableProps) {
  const { formatDate } = useFormatDate();
  const { t: tSettings } = useT('settings');

  const columns = useMemo<ColumnDef<ApiKey>[]>(() => {
    return [
      {
        id: 'name',
        header: tSettings('apiKeys.columns.name'),
        cell: ({ row }) => (
          <span className="text-foreground font-medium">
            {row.original.name || '-'}
          </span>
        ),
        size: 200,
      },
      {
        id: 'prefix',
        header: tSettings('apiKeys.columns.prefix'),
        cell: ({ row }) => (
          <code className="bg-muted rounded px-2 py-1 font-mono text-sm">
            {row.original.start || row.original.prefix || '-'}...
          </code>
        ),
        size: 150,
      },
      {
        id: 'created',
        header: tSettings('apiKeys.columns.created'),
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.createdAt
              ? formatDate(new Date(row.original.createdAt), 'short')
              : '-'}
          </span>
        ),
        size: 150,
      },
      {
        id: 'lastUsed',
        header: tSettings('apiKeys.columns.lastUsed'),
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.lastRequest
              ? formatDate(new Date(row.original.lastRequest), 'short')
              : tSettings('apiKeys.neverUsed')}
          </span>
        ),
        size: 150,
      },
      {
        id: 'expires',
        header: tSettings('apiKeys.columns.expires'),
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.expiresAt
              ? formatDate(new Date(row.original.expiresAt), 'short')
              : tSettings('apiKeys.never')}
          </span>
        ),
        size: 150,
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <HStack gap={1} justify="end">
            <ApiKeyRowActions
              apiKey={row.original}
              organizationId={organizationId}
            />
          </HStack>
        ),
        size: 80,
      },
    ];
  }, [tSettings, organizationId, formatDate]);

  if (isLoading) {
    return null;
  }

  if (apiKeys.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Key className="text-muted-foreground/50 mb-4 size-12" />
        <h3 className="text-foreground text-lg font-medium">
          {tSettings('apiKeys.noKeys')}
        </h3>
        <p className="text-muted-foreground mt-1 max-w-sm text-sm">
          {tSettings('apiKeys.noKeysDescription')}
        </p>
      </div>
    );
  }

  return (
    <DataTable columns={columns} data={apiKeys} getRowId={(row) => row.id} />
  );
}

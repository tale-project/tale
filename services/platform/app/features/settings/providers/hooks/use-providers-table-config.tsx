'use client';

import { Text } from '@tale/ui/text';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';

import type { ProviderRow } from '../components/providers-table';

interface ProvidersTableConfig {
  columns: ColumnDef<ProviderRow>[];
  stickyLayout: boolean;
  pageSize: number;
}

export function useProvidersTableConfig(): ProvidersTableConfig {
  const { t } = useT('settings');

  const columns = useMemo<ColumnDef<ProviderRow>[]>(
    () => [
      {
        id: 'displayName',
        header: t('providers.displayName'),
        cell: ({ row }) => (
          <Text as="span" variant="label">
            {row.original.displayName}
          </Text>
        ),
      },
      {
        id: 'baseUrl',
        header: t('providers.baseUrl'),
        cell: ({ row }) => (
          <Text
            as="span"
            variant="muted"
            className="block max-w-[300px] truncate"
          >
            {row.original.baseUrl}
          </Text>
        ),
      },
      {
        id: 'models',
        header: t('providers.models'),
        meta: { skeleton: { type: 'text' } },
        cell: ({ row }) => (
          <Text as="span" variant="muted">
            {t('providers.modelCount', { count: row.original.modelCount ?? 0 })}
          </Text>
        ),
        size: 120,
      },
    ],
    [t],
  );

  return {
    columns,
    stickyLayout: false,
    pageSize: 50,
  };
}

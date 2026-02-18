'use client';

import { Key } from 'lucide-react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { useListPage } from '@/app/hooks/use-list-page';
import { useT } from '@/lib/i18n/client';

import type { ApiKey } from '../types';

import { useApiKeysTableConfig } from '../hooks/use-api-keys-table-config';
import { ApiKeysActionMenu } from './api-keys-action-menu';

interface ApiKeysTableProps {
  apiKeys: ApiKey[] | undefined;
  organizationId: string;
}

export function ApiKeysTable({ apiKeys, organizationId }: ApiKeysTableProps) {
  const { t: tEmpty } = useT('emptyStates');
  const { columns, searchPlaceholder, stickyLayout, pageSize } =
    useApiKeysTableConfig(organizationId);

  const list = useListPage<ApiKey>({
    dataSource: { type: 'query', data: apiKeys },
    pageSize,
    search: { fields: ['name'], placeholder: searchPlaceholder },
    getRowId: (row) => row.id,
  });

  return (
    <DataTable
      columns={columns}
      stickyLayout={stickyLayout}
      actionMenu={<ApiKeysActionMenu organizationId={organizationId} />}
      emptyState={{
        icon: Key,
        title: tEmpty('apiKeys.title'),
        description: tEmpty('apiKeys.description'),
      }}
      {...list.tableProps}
    />
  );
}

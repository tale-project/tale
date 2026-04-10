'use client';

import { BookOpen, Key } from 'lucide-react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { Stack } from '@/app/components/ui/layout/layout';
import { buttonVariants } from '@/app/components/ui/primitives/button';
import { useListPage } from '@/app/hooks/use-list-page';
import { useT } from '@/lib/i18n/client';

import { useApiKeysTableConfig } from '../hooks/use-api-keys-table-config';
import type { ApiKey } from '../types';
import { ApiKeysActionMenu } from './api-keys-action-menu';

interface ApiKeysTableProps {
  apiKeys: ApiKey[] | undefined;
  organizationId: string;
}

function ApiDocsLink() {
  const { t: tSettings } = useT('settings');

  return (
    <div className="flex justify-center py-4">
      <a
        href="/docs"
        target="_blank"
        rel="noopener noreferrer"
        className={buttonVariants({ variant: 'secondary', size: 'sm' })}
      >
        <BookOpen className="mr-2 size-4" />
        {tSettings('apiDocs.openDocs')}
      </a>
    </div>
  );
}

export function ApiKeysTable({ apiKeys, organizationId }: ApiKeysTableProps) {
  const { t: tEmpty } = useT('emptyStates');
  const { columns, searchPlaceholder, stickyLayout, pageSize } =
    useApiKeysTableConfig(organizationId);

  const { t: tSettings } = useT('settings');

  const list = useListPage<ApiKey>({
    dataSource: { type: 'query', data: apiKeys },
    pageSize,
    search: { fields: ['name'], placeholder: searchPlaceholder },
    getRowId: (row) => row.id,
    entityLabel: tSettings('apiKeys.entityLabel'),
  });

  const hasKeys = apiKeys && apiKeys.length > 0;

  return (
    <Stack gap={0}>
      <DataTable
        columns={columns}
        stickyLayout={stickyLayout}
        actionMenu={<ApiKeysActionMenu organizationId={organizationId} />}
        emptyState={{
          icon: Key,
          title: tEmpty('apiKeys.title'),
          description: (
            <>
              {tEmpty('apiKeys.description')}
              <ApiDocsLink />
            </>
          ),
        }}
        {...list.tableProps}
      />
      {hasKeys && <ApiDocsLink />}
    </Stack>
  );
}

'use client';

import { buttonVariants } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import type { RowSelectionState } from '@tanstack/react-table';
import { BookOpen, Key } from 'lucide-react';
import { useCallback, useState } from 'react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { BulkDeleteBar } from '@/app/components/ui/data-table/data-table-bulk-actions';
import { useListPage } from '@/app/hooks/use-list-page';
import { useT } from '@/lib/i18n/client';

import { useRevokeApiKey } from '../hooks/use-api-keys';
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
    <Row gap={0} align="stretch" justify="center" className="py-4">
      <a
        href="/docs"
        target="_blank"
        rel="noopener noreferrer"
        className={buttonVariants({ variant: 'secondary', size: 'sm' })}
      >
        <BookOpen className="mr-2 size-4" />
        {tSettings('apiDocs.openDocs')}
      </a>
    </Row>
  );
}

export function ApiKeysTable({ apiKeys, organizationId }: ApiKeysTableProps) {
  const { t: tEmpty } = useT('emptyStates');
  const { columns, searchPlaceholder, stickyLayout, pageSize } =
    useApiKeysTableConfig(organizationId);

  const { t: tSettings } = useT('settings');

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  // Lifted so the action menu and the empty-state CTA share one dialog.
  const [createOpen, setCreateOpen] = useState(false);
  const revokeApiKey = useRevokeApiKey(organizationId);

  const handleClearSelection = useCallback(() => {
    setRowSelection({});
  }, []);

  const handleDeleteItem = useCallback(
    async (id: string) => {
      // `useRevokeApiKey` takes the keyId directly and throws on auth-client
      // failure; the bar surfaces a destructive toast for the whole batch.
      await revokeApiKey.mutateAsync(id);
    },
    [revokeApiKey],
  );

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
        enableRowSelection
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        actionMenu={
          <ApiKeysActionMenu
            organizationId={organizationId}
            createOpen={createOpen}
            onCreateOpenChange={setCreateOpen}
          />
        }
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
        footer={
          <BulkDeleteBar
            rowSelection={rowSelection}
            onClearSelection={handleClearSelection}
            onDeleteItem={handleDeleteItem}
            onDeleteComplete={handleClearSelection}
          />
        }
        {...list.tableProps}
      />
      {hasKeys && <ApiDocsLink />}
    </Stack>
  );
}

'use client';

import { buttonVariants } from '@tale/ui/button';
import { DataTable } from '@tale/ui/data-table/data-table';
import { BulkDeleteBar } from '@tale/ui/data-table/data-table-bulk-actions';
import { Stack } from '@tale/ui/layout';
import { useListPage } from '@tale/ui/use-list-page';
import type { RowSelectionState } from '@tanstack/react-table';
import { BookOpen, Key, Plus } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

import { useT } from '@/lib/i18n/client';

import { useRevokeApiKey } from '../hooks/use-api-keys';
import { useApiKeysTableConfig } from '../hooks/use-api-keys-table-config';
import type { ApiKey } from '../types';
import { ApiKeyCreateDialog } from './api-key-create-dialog';

interface ApiKeysTableProps {
  apiKeys: ApiKey[] | undefined;
  organizationId: string;
  error?: Error | null;
  onRetry?: () => void;
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

export function ApiKeysTable({
  apiKeys,
  organizationId,
  error,
  onRetry,
}: ApiKeysTableProps) {
  const { t: tEmpty } = useT('emptyStates');
  const { columns, stickyLayout, pageSize } =
    useApiKeysTableConfig(organizationId);

  const { t: tSettings } = useT('settings');

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [createOpen, setCreateOpen] = useState(false);
  const createTriggerRef = useRef<HTMLButtonElement>(null);
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

  // No search box: an org holds a handful of keys, named deliberately —
  // the list is scannable at a glance and a query field would be chrome.
  const list = useListPage<ApiKey>({
    dataSource: {
      type: 'query',
      data: apiKeys,
      // A cold failure needs recovery. A failed refresh of a known-empty
      // list must keep its Create opener mounted: creation can still reveal
      // the one-time secret and restore focus there when Done is pressed.
      error: apiKeys === undefined ? error : null,
      retry: onRetry,
    },
    pageSize,
    getRowId: (row) => row.id,
    entityLabel: {
      one: tSettings('apiKeys.entityLabelOne'),
      other: tSettings('apiKeys.entityLabel'),
    },
  });

  return (
    <Stack gap={0}>
      <DataTable
        columns={columns}
        stickyLayout={stickyLayout}
        enableRowSelection
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        // The standard create affordance. With no search box on this table,
        // DataTable puts it in the empty state while there are no keys and in
        // the toolbar once there are. Wait for the initial read so a focused
        // toolbar opener cannot be removed when that read comes back empty.
        addAction={
          apiKeys === undefined
            ? undefined
            : {
                triggerRef: createTriggerRef,
                label: tSettings('apiKeys.createKey'),
                icon: Plus,
                onClick: () => setCreateOpen(true),
              }
        }
        emptyState={{
          icon: Key,
          title: tEmpty('apiKeys.title'),
          description: tEmpty('apiKeys.description'),
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
      {/* Below the table in every state, so the docs never move between the
          empty state and the list. */}
      <ApiDocsLink />
      <ApiKeyCreateDialog
        restoreFocusRef={createTriggerRef}
        open={createOpen}
        onOpenChange={setCreateOpen}
        organizationId={organizationId}
      />
    </Stack>
  );
}

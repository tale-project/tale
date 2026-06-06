'use client';

import { Button } from '@tale/ui/button';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { IconButton } from '@tale/ui/icon-button';
import { useQueryClient } from '@tanstack/react-query';
import type { Row, RowSelectionState } from '@tanstack/react-table';
import { Ellipsis, Pencil, Plus, Server, Trash2, Zap } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import {
  ACTIONS_COLUMN_SIZE,
  createSelectColumn,
} from '@/app/components/ui/data-table/column-builders';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { BulkDeleteBar } from '@/app/components/ui/data-table/data-table-bulk-actions';
import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { useListPage } from '@/app/hooks/use-list-page';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { resolveProviderLocale } from '@/lib/shared/utils/resolve-provider-locale';

import { useDeleteProvider } from '../hooks/mutations';
import { useListProviders, useReadProvider } from '../hooks/queries';
import { ProviderConfigProvider } from '../hooks/use-provider-config-context';
import { useProvidersTableConfig } from '../hooks/use-providers-table-config';
import { dispatchOrgAccessError } from '../utils/error-dispatch';
import { ProviderAddPanel } from './provider-add-panel';
import { ProviderDetailDrawer } from './provider-detail-drawer';
import { ProviderEditPanel } from './provider-edit-panel';
import { TestConnectionSheet } from './test-connection-sheet';

export interface ProviderRow {
  name: string;
  displayName: string;
  description?: string;
  baseUrl?: string;
  modelCount?: number;
}

interface ProvidersTableProps {
  organizationId: string;
  /**
   * When set, the drawer auto-opens for this provider on mount. Used by the
   * deep-link route (`/providers/$providerName`) to render the list and open
   * the detail drawer in a single render — preserves shareable URLs after the
   * detail page was collapsed into a drawer.
   */
  initialDetailProvider?: string;
}

export function ProvidersTable({
  organizationId,
  initialDetailProvider,
}: ProvidersTableProps) {
  const { t } = useT('settings');
  const { t: tEmpty } = useT('emptyStates');
  const { t: tCommon } = useT('common');
  const { t: tAccessDenied } = useT('accessDenied');
  const queryClient = useQueryClient();
  const { locale } = useLocale();
  const { providers: rawProviders, isLoading } =
    useListProviders(organizationId);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editProvider, setEditProvider] = useState<ProviderRow | null>(null);
  const [testProvider, setTestProvider] = useState<ProviderRow | null>(null);
  const [deleteProvider, setDeleteProvider] = useState<ProviderRow | null>(
    null,
  );
  const [detailProvider, setDetailProvider] = useState(
    initialDetailProvider ?? null,
  );
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const deleteProviderMutation = useDeleteProvider();

  const handleClearSelection = useCallback(() => {
    setRowSelection({});
  }, []);

  const handleBulkDeleteItem = useCallback(
    async (providerName: string) => {
      // Per-row delete reuses the same mutation as the single-row dialog so
      // server-side audit logging stays consistent. The bar surfaces a
      // destructive toast for the batch on failure.
      await deleteProviderMutation.mutateAsync({
        organizationId,
        providerName,
      });
    },
    [deleteProviderMutation, organizationId],
  );

  const providers = useMemo(() => {
    if (!rawProviders) return [];
    const valid: ProviderRow[] = [];
    for (const p of rawProviders) {
      if (p && 'displayName' in p && typeof p.displayName === 'string') {
        const resolved = resolveProviderLocale(
          {
            displayName: p.displayName,
            description: p.description,
            i18n: p.i18n,
          },
          locale,
        );
        valid.push({
          name: p.name,
          displayName: resolved.displayName || p.displayName,
          description: resolved.description,
          baseUrl: p.baseUrl,
          modelCount: p.modelCount,
        });
      }
    }
    return valid;
  }, [rawProviders, locale]);

  const invalidateProviders = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['config', 'providers'] });
  }, [queryClient]);

  const { columns, stickyLayout, pageSize } = useProvidersTableConfig();

  const handleRowClick = useCallback((row: Row<ProviderRow>) => {
    setDetailProvider(row.original.name);
  }, []);

  const handleDelete = useCallback(async () => {
    if (!deleteProvider) return;
    try {
      await deleteProviderMutation.mutateAsync({
        organizationId,
        providerName: deleteProvider.name,
      });
      toast({ title: t('providers.deleted') });
      setDeleteProvider(null);
      invalidateProviders();
    } catch (err) {
      if (!dispatchOrgAccessError(err, tAccessDenied)) {
        console.error('[providers-table] delete failed', err);
        toast({ title: t('providers.deleteFailed'), variant: 'destructive' });
      }
    }
  }, [
    deleteProvider,
    deleteProviderMutation,
    t,
    tAccessDenied,
    invalidateProviders,
    organizationId,
  ]);

  const columnsWithActions = useMemo(
    () => [
      // Multi-row select — canonical 40px column matching every other entity
      // table. Enables bulk-delete via the `BulkDeleteBar` footer.
      createSelectColumn<ProviderRow>(),
      ...columns,
      {
        id: 'actions',
        // Single canonical width so the 3-dot column lands at the same
        // x-offset as every other table's actions column. See
        // `ACTIONS_COLUMN_SIZE` for the source-of-truth comment.
        size: ACTIONS_COLUMN_SIZE,
        cell: ({ row }: { row: Row<ProviderRow> }) => (
          <ProviderRowActions
            onEdit={() => setEditProvider(row.original)}
            onTest={() => setTestProvider(row.original)}
            onDelete={() => setDeleteProvider(row.original)}
          />
        ),
      },
    ],
    [columns],
  );

  const list = useListPage<ProviderRow>({
    dataSource: { type: 'query', data: isLoading ? undefined : providers },
    pageSize,
    search: {
      fields: ['displayName', 'baseUrl'],
      placeholder: t('providers.searchProvider'),
    },
    entityLabel: t('providers.entityLabel'),
  });

  return (
    <>
      <DataTable
        {...list.tableProps}
        columns={columnsWithActions}
        stickyLayout={stickyLayout}
        enableRowSelection
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        // Providers are keyed by `name`, not `_id` — RowSelectionState uses
        // the row's `id` field by default, which TanStack derives from the
        // row's accessor when no `getRowId` is supplied. Pin it to `name`
        // explicitly so the bulk handler receives the same string the
        // delete mutation expects.
        getRowId={(row) => row.name}
        onRowClick={handleRowClick}
        actionMenu={
          <Button onClick={() => setAddDialogOpen(true)}>
            <Plus className="mr-1.5 size-4" />
            {t('providers.addProvider')}
          </Button>
        }
        emptyState={{
          icon: Server,
          title: tEmpty('providers.title'),
          description: tEmpty('providers.description'),
        }}
        footer={
          <BulkDeleteBar
            rowSelection={rowSelection}
            onClearSelection={handleClearSelection}
            onDeleteItem={handleBulkDeleteItem}
            onDeleteComplete={handleClearSelection}
          />
        }
      />

      <ProviderAddPanel
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        organizationId={organizationId}
      />

      {editProvider && (
        <ProviderEditPanelLoader
          providerName={editProvider.name}
          organizationId={organizationId}
          onClose={() => setEditProvider(null)}
        />
      )}

      {testProvider && (
        <TestConnectionSheet
          open
          onOpenChange={(open) => {
            if (!open) setTestProvider(null);
          }}
          organizationId={organizationId}
          providerName={testProvider.name}
        />
      )}

      <ConfirmDialog
        open={deleteProvider != null}
        onOpenChange={(open) => {
          if (!open) setDeleteProvider(null);
        }}
        title={t('providers.deleteProvider')}
        description={t('providers.deleteConfirmNamed', {
          name: deleteProvider?.displayName ?? '',
        })}
        variant="destructive"
        confirmText={t('providers.deleteProvider')}
        loadingText={tCommon('actions.deleting')}
        isLoading={deleteProviderMutation.isPending}
        onConfirm={() => void handleDelete()}
      />

      {detailProvider && (
        <ProviderDetailDrawer
          open
          onOpenChange={(open) => {
            if (!open) setDetailProvider(null);
          }}
          organizationId={organizationId}
          providerName={detailProvider}
        />
      )}
    </>
  );
}

function ProviderRowActions({
  onEdit,
  onTest,
  onDelete,
}: {
  onEdit: () => void;
  onTest: () => void;
  onDelete: () => void;
}) {
  const { t } = useT('settings');

  const items = useMemo<DropdownMenuGroup[]>(
    () => [
      [
        {
          type: 'item',
          label: t('providers.editProvider'),
          icon: Pencil,
          onClick: onEdit,
        },
        {
          type: 'item',
          label: t('providers.testConnection'),
          icon: Zap,
          onClick: onTest,
        },
      ],
      [
        {
          type: 'item',
          label: t('providers.deleteProvider'),
          icon: Trash2,
          onClick: onDelete,
          destructive: true,
        },
      ],
    ],
    [t, onEdit, onTest, onDelete],
  );

  return (
    <DropdownMenu
      trigger={
        <IconButton
          icon={Ellipsis}
          aria-label={t('providers.providerActions')}
          className="text-muted-foreground size-8"
          onClick={(e) => e.stopPropagation()}
        />
      }
      items={items}
      align="end"
    />
  );
}

/**
 * Wrapper that fetches the provider's config + hash and hands them to
 * `ProviderConfigProvider`, so the row-level Edit action gets the same
 * optimistic-concurrency context as the detail drawer. Without it,
 * `useProviderConfig` inside `ProviderEditPanel` throws.
 */
function ProviderEditPanelLoader({
  providerName,
  organizationId,
  onClose,
}: {
  providerName: string;
  organizationId: string;
  onClose: () => void;
}) {
  const { data } = useReadProvider(organizationId, providerName);
  if (!data?.ok) return null;
  return (
    <ProviderConfigProvider
      organizationId={organizationId}
      providerName={providerName}
      initialConfig={data.config}
      initialHash={data.hash}
    >
      <ProviderEditPanel
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        providerName={providerName}
        organizationId={organizationId}
      />
    </ProviderConfigProvider>
  );
}

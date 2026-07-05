'use client';

import { Button } from '@tale/ui/button';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { IconButton } from '@tale/ui/icon-button';
import { useQueryClient } from '@tanstack/react-query';
import type { Row } from '@tanstack/react-table';
import { Ellipsis, Pencil, Plus, Server, Trash2, Zap } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { ACTIONS_COLUMN_SIZE } from '@/app/components/ui/data-table/column-builders';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { useListPage } from '@/app/hooks/use-list-page';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { resolveProviderLocale } from '@/lib/shared/utils/resolve-provider-locale';

import { useDeleteProvider } from '../hooks/mutations';
import { useListProviders } from '../hooks/queries';
import { useProvidersTableConfig } from '../hooks/use-providers-table-config';
import { dispatchOrgAccessError } from '../utils/error-dispatch';
import { ProviderAddPanel } from './provider-add-panel';
import { ProviderDetailDrawer } from './provider-detail-drawer';
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
  const [testProvider, setTestProvider] = useState<ProviderRow | null>(null);
  const [deleteProvider, setDeleteProvider] = useState<ProviderRow | null>(
    null,
  );
  const [detailProvider, setDetailProvider] = useState(
    initialDetailProvider ?? null,
  );
  // When the drawer is opened via the row menu's "Edit provider" action we
  // deep-link straight into the General edit form so both entry points share
  // the drawer — the row click opens it in read mode, the menu in edit mode.
  const [detailEditGeneral, setDetailEditGeneral] = useState(false);
  const deleteProviderMutation = useDeleteProvider();

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
    setDetailEditGeneral(false);
    setDetailProvider(row.original.name);
  }, []);

  const handleEdit = useCallback((row: Row<ProviderRow>) => {
    setDetailEditGeneral(true);
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
      ...columns,
      {
        id: 'actions',
        // Single canonical width so the 3-dot column lands at the same
        // x-offset as every other table's actions column. See
        // `ACTIONS_COLUMN_SIZE` for the source-of-truth comment.
        size: ACTIONS_COLUMN_SIZE,
        cell: ({ row }: { row: Row<ProviderRow> }) => (
          <ProviderRowActions
            onEdit={() => handleEdit(row)}
            onTest={() => setTestProvider(row.original)}
            onDelete={() => setDeleteProvider(row.original)}
          />
        ),
      },
    ],
    [columns, handleEdit],
  );

  const list = useListPage<ProviderRow>({
    dataSource: { type: 'query', data: isLoading ? undefined : providers },
    pageSize,
    entityLabel: t('providers.entityLabel'),
  });

  return (
    <>
      <DataTable
        {...list.tableProps}
        columns={columnsWithActions}
        stickyLayout={stickyLayout}
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
      />

      <ProviderAddPanel
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        organizationId={organizationId}
      />

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
            if (!open) {
              setDetailProvider(null);
              setDetailEditGeneral(false);
            }
          }}
          organizationId={organizationId}
          providerName={detailProvider}
          initialEditGeneral={detailEditGeneral}
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

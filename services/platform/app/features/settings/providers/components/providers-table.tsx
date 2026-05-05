'use client';

import { Button } from '@tale/ui/button';
import { IconButton } from '@tale/ui/icon-button';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { Row } from '@tanstack/react-table';
import { Ellipsis, Pencil, Plus, Server, Trash2, Zap } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import {
  DropdownMenu,
  type DropdownMenuGroup,
} from '@/app/components/ui/overlays/dropdown-menu';
import { useOrganization } from '@/app/features/organization/hooks/queries';
import { useListPage } from '@/app/hooks/use-list-page';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useDeleteProvider } from '../hooks/mutations';
import { useListProviders } from '../hooks/queries';
import { useProvidersTableConfig } from '../hooks/use-providers-table-config';
import { ProviderAddPanel } from './provider-add-panel';
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
}

export function ProvidersTable({ organizationId }: ProvidersTableProps) {
  const { t } = useT('settings');
  const { t: tEmpty } = useT('emptyStates');
  const { t: tCommon } = useT('common');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: organization } = useOrganization(organizationId);
  const orgSlug = organization?.slug ?? '';
  const { providers: rawProviders, isLoading } = useListProviders(orgSlug);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editProvider, setEditProvider] = useState<ProviderRow | null>(null);
  const [testProvider, setTestProvider] = useState<ProviderRow | null>(null);
  const [deleteProvider, setDeleteProvider] = useState<ProviderRow | null>(
    null,
  );
  const deleteProviderMutation = useDeleteProvider();

  const providers = useMemo(() => {
    if (!rawProviders) return [];
    const valid: ProviderRow[] = [];
    for (const p of rawProviders) {
      if (p && 'displayName' in p && typeof p.displayName === 'string') {
        valid.push({
          name: p.name,
          displayName: p.displayName,
          description: p.description,
          baseUrl: p.baseUrl,
          modelCount: p.modelCount,
        });
      }
    }
    return valid;
  }, [rawProviders]);

  const invalidateProviders = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['config', 'providers'] });
  }, [queryClient]);

  const { columns, stickyLayout, pageSize } = useProvidersTableConfig();

  const handleRowClick = useCallback(
    (row: Row<ProviderRow>) => {
      void navigate({
        to: '/dashboard/$id/settings/providers/$providerName',
        params: { id: organizationId, providerName: row.original.name },
      });
    },
    [navigate, organizationId],
  );

  const handleDelete = useCallback(async () => {
    if (!deleteProvider || !orgSlug) return;
    try {
      await deleteProviderMutation.mutateAsync({
        orgSlug,
        providerName: deleteProvider.name,
      });
      toast({ title: t('providers.deleted') });
      setDeleteProvider(null);
      invalidateProviders();
    } catch {
      toast({ title: t('providers.deleteFailed'), variant: 'destructive' });
    }
  }, [deleteProvider, deleteProviderMutation, t, invalidateProviders, orgSlug]);

  const columnsWithActions = useMemo(
    () => [
      ...columns,
      {
        id: 'actions',
        size: 44,
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
  });

  return (
    <>
      <DataTable
        {...list.tableProps}
        columns={columnsWithActions}
        stickyLayout={stickyLayout}
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

      {editProvider && (
        <ProviderEditPanel
          open
          onOpenChange={(open) => {
            if (!open) setEditProvider(null);
          }}
          providerName={editProvider.name}
        />
      )}

      {testProvider && (
        <TestConnectionSheet
          open
          onOpenChange={(open) => {
            if (!open) setTestProvider(null);
          }}
          orgSlug={orgSlug}
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

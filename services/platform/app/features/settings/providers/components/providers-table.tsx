'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { Row } from '@tanstack/react-table';
import { Ellipsis, Pencil, Plus, Server, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import {
  DropdownMenu,
  type DropdownMenuGroup,
} from '@/app/components/ui/overlays/dropdown-menu';
import { Button } from '@/app/components/ui/primitives/button';
import { IconButton } from '@/app/components/ui/primitives/icon-button';
import { useListPage } from '@/app/hooks/use-list-page';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useDeleteProvider } from '../hooks/mutations';
import { useListProviders } from '../hooks/queries';
import { useProvidersTableConfig } from '../hooks/use-providers-table-config';
import { ProviderAddDialog } from './provider-add-dialog';
import { ProviderEditDialog } from './provider-edit-dialog';

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
  const { providers: rawProviders, isLoading } = useListProviders('default');
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editProvider, setEditProvider] = useState<ProviderRow | null>(null);
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
    if (!deleteProvider) return;
    try {
      await deleteProviderMutation.mutateAsync({
        orgSlug: 'default',
        providerName: deleteProvider.name,
      });
      toast({ title: t('providers.deleted'), variant: 'success' });
      setDeleteProvider(null);
      invalidateProviders();
    } catch {
      toast({ title: t('providers.deleteFailed'), variant: 'destructive' });
    }
  }, [deleteProvider, deleteProviderMutation, t, invalidateProviders]);

  const columnsWithActions = useMemo(
    () => [
      ...columns,
      {
        id: 'actions',
        size: 44,
        cell: ({ row }: { row: Row<ProviderRow> }) => (
          <ProviderRowActions
            onEdit={() => setEditProvider(row.original)}
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

      <ProviderAddDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        organizationId={organizationId}
      />

      {editProvider && (
        <ProviderEditDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditProvider(null);
          }}
          providerName={editProvider.name}
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
  onDelete,
}: {
  onEdit: () => void;
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
    [t, onEdit, onDelete],
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

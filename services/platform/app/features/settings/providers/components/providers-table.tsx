'use client';

import type { Row } from '@tanstack/react-table';

import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Plus, Server } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { Button } from '@/app/components/ui/primitives/button';
import { useListPage } from '@/app/hooks/use-list-page';
import { useT } from '@/lib/i18n/client';

import { useListProviders } from '../hooks/queries';
import { useProvidersTableConfig } from '../hooks/use-providers-table-config';
import { ProviderAddDialog } from './provider-add-dialog';

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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { providers: rawProviders, isLoading } = useListProviders('default');
  const [addDialogOpen, setAddDialogOpen] = useState(false);

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

  const { columns, stickyLayout, pageSize } = useProvidersTableConfig({
    onDeleted: invalidateProviders,
  });

  const handleRowClick = useCallback(
    (row: Row<ProviderRow>) => {
      void navigate({
        to: '/dashboard/$id/settings/providers/$providerName',
        params: { id: organizationId, providerName: row.original.name },
      });
    },
    [navigate, organizationId],
  );

  const list = useListPage<ProviderRow>({
    dataSource: { type: 'query', data: isLoading ? undefined : providers },
    pageSize,
  });

  return (
    <>
      <DataTable
        className="p-4"
        {...list.tableProps}
        columns={columns}
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
    </>
  );
}

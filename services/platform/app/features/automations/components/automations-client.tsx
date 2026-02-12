'use client';

import { useNavigate } from '@tanstack/react-router';
import { type Row } from '@tanstack/react-table';
import { Workflow } from 'lucide-react';
import { useCallback } from 'react';

import type { Doc } from '@/convex/_generated/dataModel';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { useListPage } from '@/app/hooks/use-list-page';
import { useT } from '@/lib/i18n/client';

import { useWfAutomationCollection } from '../hooks/collections';
import { useAutomations } from '../hooks/queries';
import { AutomationsActionMenu } from './automations-action-menu';
import { useAutomationsTableConfig } from './use-automations-table-config';

interface AutomationsClientProps {
  organizationId: string;
}

export function AutomationsClient({ organizationId }: AutomationsClientProps) {
  const navigate = useNavigate();
  const { t: tTables } = useT('tables');
  const { t: tCommon } = useT('common');
  const { t: tEmpty } = useT('emptyStates');

  const { columns, searchPlaceholder, stickyLayout, pageSize } =
    useAutomationsTableConfig();

  const wfAutomationCollection = useWfAutomationCollection(organizationId);
  const { automations, isLoading } = useAutomations(wfAutomationCollection);

  const handleRowClick = useCallback(
    (row: Row<Doc<'wfDefinitions'>>) => {
      void navigate({
        to: '/dashboard/$id/automations/$amId',
        params: { id: organizationId, amId: row.original._id },
      });
    },
    [navigate, organizationId],
  );

  const list = useListPage({
    dataSource: {
      type: 'query',
      data: isLoading ? undefined : (automations ?? []),
    },
    pageSize,
    search: {
      fields: ['name', 'description'],
      placeholder: searchPlaceholder,
    },
    filters: {
      definitions: [
        {
          key: 'status',
          title: tTables('headers.status'),
          options: [
            { value: 'active', label: tCommon('status.published') },
            { value: 'draft', label: tCommon('status.draft') },
            { value: 'archived', label: tCommon('status.archived') },
          ],
        },
      ],
    },
  });

  return (
    <DataTable
      className="px-4 py-6"
      columns={columns}
      onRowClick={handleRowClick}
      stickyLayout={stickyLayout}
      actionMenu={<AutomationsActionMenu organizationId={organizationId} />}
      emptyState={{
        icon: Workflow,
        title: tEmpty('automations.title'),
        description: tEmpty('automations.description'),
      }}
      {...list.tableProps}
    />
  );
}

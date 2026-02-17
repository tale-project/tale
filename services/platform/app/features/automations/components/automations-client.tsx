'use client';

import { useNavigate } from '@tanstack/react-router';
import { type Row } from '@tanstack/react-table';
import { Workflow } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import type { Doc } from '@/convex/_generated/dataModel';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { useListPage } from '@/app/hooks/use-list-page';
import { useT } from '@/lib/i18n/client';

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

  const { automations, isLoading } = useAutomations(organizationId);

  const activeVersionMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of automations) {
      if (a.activeVersionId) map.set(a._id, a.activeVersionId);
    }
    return map;
  }, [automations]);

  const tableData = useMemo(
    () => automations.map(({ activeVersionId: _, ...rest }) => rest),
    [automations],
  );

  const handleRowClick = useCallback(
    (row: Row<Doc<'wfDefinitions'>>) => {
      const amId = activeVersionMap.get(row.original._id) ?? row.original._id;
      void navigate({
        to: '/dashboard/$id/automations/$amId',
        params: { id: organizationId, amId },
      });
    },
    [navigate, organizationId, activeVersionMap],
  );

  const list = useListPage({
    dataSource: {
      type: 'query',
      data: isLoading ? undefined : tableData,
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

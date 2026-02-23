'use client';

import { useNavigate } from '@tanstack/react-router';
import { type Row } from '@tanstack/react-table';
import { Workflow } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import type { Doc } from '@/convex/_generated/dataModel';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { useListPage } from '@/app/hooks/use-list-page';
import { useT } from '@/lib/i18n/client';

import {
  useApproxAutomationCount,
  useListAutomationsPaginated,
} from '../hooks/queries';
import { useAutomationsTableConfig } from '../hooks/use-automations-table-config';
import { AutomationsActionMenu } from './automations-action-menu';

interface AutomationsTableProps {
  organizationId: string;
}

export function AutomationsTable({ organizationId }: AutomationsTableProps) {
  const navigate = useNavigate();
  const { t: tTables } = useT('tables');
  const { t: tCommon } = useT('common');
  const { t: tEmpty } = useT('emptyStates');

  const { data: count } = useApproxAutomationCount(organizationId);
  const { columns, searchPlaceholder, stickyLayout, pageSize } =
    useAutomationsTableConfig();
  const paginatedResult = useListAutomationsPaginated({
    organizationId,
    initialNumItems: pageSize,
  });

  const activeVersionMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of paginatedResult.results ?? []) {
      if (a.activeVersionId) map.set(a._id, a.activeVersionId);
    }
    return map;
  }, [paginatedResult.results]);

  const tableResults = useMemo(
    (): Doc<'wfDefinitions'>[] =>
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      paginatedResult.results?.map(({ activeVersionId: _, ...rest }) => rest) ??
      [],
    [paginatedResult.results],
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

  const list = useListPage<Doc<'wfDefinitions'>>({
    dataSource: {
      type: 'paginated',
      results: tableResults,
      status: paginatedResult.status,
      loadMore: paginatedResult.loadMore,
      isLoading: paginatedResult.isLoading,
    },
    pageSize,
    search: {
      fields: ['name', 'description'],
      placeholder: searchPlaceholder,
    },
    approxRowCount: count,
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
      className="p-4"
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

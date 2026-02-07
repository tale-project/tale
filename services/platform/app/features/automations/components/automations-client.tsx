'use client';

import { useMemo, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { Workflow } from 'lucide-react';
import { type Row } from '@tanstack/react-table';
import { api } from '@/convex/_generated/api';
import type { Doc } from '@/convex/_generated/dataModel';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { AutomationsActionMenu } from './automations-action-menu';
import { useAutomationsTableConfig } from './use-automations-table-config';
import { useT } from '@/lib/i18n/client';
import { AutomationsTableSkeleton } from './automations-table-skeleton';
import { useListPage } from '@/app/hooks/use-list-page';

interface AutomationsClientProps {
  organizationId: string;
  searchTerm?: string;
  status?: string[];
}

export function AutomationsClient({
  organizationId,
  searchTerm,
  status,
}: AutomationsClientProps) {
  const navigate = useNavigate();
  const { t: tTables } = useT('tables');
  const { t: tCommon } = useT('common');
  const { t: tEmpty } = useT('emptyStates');

  const { columns, searchPlaceholder, stickyLayout, pageSize } =
    useAutomationsTableConfig();

  const queryArgs = useMemo(
    () => ({
      organizationId,
      searchTerm: searchTerm || undefined,
      status: status && status.length > 0 ? status : undefined,
    }),
    [organizationId, searchTerm, status],
  );

  const automationsResult = useQuery(
    api.wf_definitions.queries.listAutomations,
    queryArgs,
  );

  const handleRowClick = useCallback(
    (row: Row<Doc<'wfDefinitions'>>) => {
      navigate({
        to: '/dashboard/$id/automations/$amId',
        params: { id: organizationId, amId: row.original._id },
      });
    },
    [navigate, organizationId],
  );

  const handleSearchChange = useCallback(
    (value: string) => {
      navigate({
        to: '/dashboard/$id/automations',
        params: { id: organizationId },
        search: { query: value || undefined, status: status?.[0] },
      });
    },
    [navigate, organizationId, status],
  );

  const handleStatusChange = useCallback(
    (values: string[]) => {
      navigate({
        to: '/dashboard/$id/automations',
        params: { id: organizationId },
        search: { query: searchTerm, status: values[0] || undefined },
      });
    },
    [navigate, organizationId, searchTerm],
  );

  const handleClearFilters = useCallback(() => {
    navigate({
      to: '/dashboard/$id/automations',
      params: { id: organizationId },
      search: {},
    });
  }, [navigate, organizationId]);

  const filterConfigs = useMemo(
    () => [
      {
        key: 'status',
        title: tTables('headers.status'),
        options: [
          { value: 'active', label: tCommon('status.published') },
          { value: 'draft', label: tCommon('status.draft') },
        ],
        selectedValues: status ?? [],
        onChange: handleStatusChange,
      },
    ],
    [status, tTables, tCommon, handleStatusChange],
  );

  const list = useListPage({
    dataSource: {
      type: 'query',
      data: automationsResult ?? undefined,
    },
    pageSize,
    search: {
      value: searchTerm ?? '',
      onChange: handleSearchChange,
      placeholder: searchPlaceholder,
    },
    filters: {
      configs: filterConfigs,
      onClear: handleClearFilters,
    },
  });

  if (automationsResult === undefined) {
    return <AutomationsTableSkeleton organizationId={organizationId} />;
  }

  return (
    <DataTable
      className="py-6 px-4"
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

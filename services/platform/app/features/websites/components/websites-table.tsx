'use client';

import type { UsePaginatedQueryResult } from 'convex/react';

import { useNavigate } from '@tanstack/react-router';
import { Globe } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import type { Doc } from '@/convex/_generated/dataModel';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { useListPage } from '@/app/hooks/use-list-page';
import { useT } from '@/lib/i18n/client';

import { useWebsitesTableConfig } from '../hooks/use-websites-table-config';
import { WebsitesActionMenu } from './websites-action-menu';

type Website = Doc<'websites'>;

export interface WebsitesTableProps {
  organizationId: string;
  paginatedResult: UsePaginatedQueryResult<Website>;
  status?: string;
}

export function WebsitesTable({
  organizationId,
  paginatedResult,
  status,
}: WebsitesTableProps) {
  const navigate = useNavigate();
  const { t: tTables } = useT('tables');
  const { t: tEmpty } = useT('emptyStates');
  const { t: tWebsites } = useT('websites');

  const { columns, searchPlaceholder, stickyLayout, pageSize } =
    useWebsitesTableConfig();

  const handleStatusChange = useCallback(
    (values: string[]) => {
      void navigate({
        to: '/dashboard/$id/websites',
        params: { id: organizationId },
        search: (prev) => ({
          ...prev,
          status: values[0] || undefined,
        }),
      });
    },
    [navigate, organizationId],
  );

  const handleClearFilters = useCallback(() => {
    void navigate({
      to: '/dashboard/$id/websites',
      params: { id: organizationId },
      search: {},
    });
  }, [navigate, organizationId]);

  const filterConfigs = useMemo(
    () => [
      {
        key: 'status',
        title: tTables('headers.status'),
        multiSelect: false,
        options: [
          { value: 'active', label: tWebsites('filter.status.active') },
          { value: 'scanning', label: tWebsites('filter.status.scanning') },
          { value: 'error', label: tWebsites('filter.status.error') },
        ],
        selectedValues: status ? [status] : [],
        onChange: handleStatusChange,
      },
    ],
    [status, tTables, tWebsites, handleStatusChange],
  );

  const list = useListPage<Website>({
    dataSource: {
      type: 'paginated',
      results: paginatedResult.results,
      status: paginatedResult.status,
      loadMore: paginatedResult.loadMore,
      isLoading: paginatedResult.isLoading,
    },
    pageSize,
    search: {
      fields: ['domain', 'title', 'description'],
      placeholder: searchPlaceholder,
    },
    filters: {
      configs: filterConfigs,
      onClear: handleClearFilters,
    },
  });

  return (
    <DataTable
      columns={columns}
      stickyLayout={stickyLayout}
      actionMenu={<WebsitesActionMenu organizationId={organizationId} />}
      emptyState={{
        icon: Globe,
        title: tEmpty('websites.title'),
        description: tEmpty('websites.description'),
      }}
      {...list.tableProps}
    />
  );
}

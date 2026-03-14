'use client';

import type { Row } from '@tanstack/react-table';

import { useNavigate } from '@tanstack/react-router';
import { Globe } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { Doc } from '@/convex/_generated/dataModel';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { useListPage } from '@/app/hooks/use-list-page';
import { useT } from '@/lib/i18n/client';

import { useSyncWebsiteStatuses } from '../hooks/mutations';
import {
  useApproxWebsiteCount,
  useListWebsitesPaginated,
} from '../hooks/queries';
import { useWebsitesTableConfig } from '../hooks/use-websites-table-config';
import { ViewWebsiteDialog } from './website-view-dialog';
import { WebsitesActionMenu } from './websites-action-menu';

type Website = Doc<'websites'>;

export interface WebsitesTableProps {
  organizationId: string;
  status?: string;
  interval?: string;
}

export function WebsitesTable({
  organizationId,
  status,
  interval,
}: WebsitesTableProps) {
  const navigate = useNavigate();
  const { t: tTables } = useT('tables');
  const { t: tEmpty } = useT('emptyStates');
  const { t: tWebsites } = useT('websites');

  const { data: count } = useApproxWebsiteCount(organizationId);
  const { mutate: syncStatuses } = useSyncWebsiteStatuses();

  useEffect(() => {
    const key = `websites-sync-${organizationId}`;
    const lastSync = sessionStorage.getItem(key);
    const fiveMinutes = 5 * 60 * 1000;
    if (lastSync && Date.now() - Number(lastSync) < fiveMinutes) return;
    sessionStorage.setItem(key, String(Date.now()));
    syncStatuses({ organizationId });
  }, [organizationId, syncStatuses]);
  const { columns, searchPlaceholder, stickyLayout, pageSize } =
    useWebsitesTableConfig();
  const paginatedResult = useListWebsitesPaginated({
    organizationId,
    status,
    initialNumItems: pageSize,
  });

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

  const handleIntervalChange = useCallback(
    (values: string[]) => {
      void navigate({
        to: '/dashboard/$id/websites',
        params: { id: organizationId },
        search: (prev) => ({
          ...prev,
          interval: values[0] || undefined,
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
        options: [
          { value: 'idle', label: tWebsites('filter.status.idle') },
          { value: 'scanning', label: tWebsites('filter.status.scanning') },
          { value: 'active', label: tWebsites('filter.status.active') },
          { value: 'error', label: tWebsites('filter.status.error') },
        ],
        selectedValues: status ? [status] : [],
        onChange: handleStatusChange,
      },
      {
        key: 'interval',
        title: tTables('headers.interval'),
        options: [
          { value: '60m', label: tWebsites('filter.interval.60m') },
          { value: '6h', label: tWebsites('filter.interval.6h') },
          { value: '12h', label: tWebsites('filter.interval.12h') },
          { value: '1d', label: tWebsites('filter.interval.1d') },
          { value: '5d', label: tWebsites('filter.interval.5d') },
          { value: '7d', label: tWebsites('filter.interval.7d') },
          { value: '30d', label: tWebsites('filter.interval.30d') },
        ],
        selectedValues: interval ? [interval] : [],
        onChange: handleIntervalChange,
      },
    ],
    [
      status,
      interval,
      tTables,
      tWebsites,
      handleStatusChange,
      handleIntervalChange,
    ],
  );

  const [viewingWebsite, setViewingWebsite] = useState<Website | null>(null);

  const handleRowClick = useCallback((row: Row<Website>) => {
    setViewingWebsite(row.original);
  }, []);

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
    approxRowCount: count,
  });

  return (
    <>
      <DataTable
        columns={columns}
        stickyLayout={stickyLayout}
        onRowClick={handleRowClick}
        actionMenu={<WebsitesActionMenu organizationId={organizationId} />}
        emptyState={{
          icon: Globe,
          title: tEmpty('websites.title'),
          description: tEmpty('websites.description'),
        }}
        {...list.tableProps}
      />

      {viewingWebsite && (
        <ViewWebsiteDialog
          isOpen={!!viewingWebsite}
          onClose={() => setViewingWebsite(null)}
          website={viewingWebsite}
        />
      )}
    </>
  );
}

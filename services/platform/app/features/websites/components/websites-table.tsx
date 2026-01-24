'use client';

import { useMemo, useState } from 'react';
import { usePaginatedQuery } from 'convex/react';
import { Globe } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { WebsitesActionMenu } from './websites-action-menu';
import { useWebsitesTableConfig } from '../hooks/use-websites-table-config';
import { useT } from '@/lib/i18n/client';
import {
  filterByTextSearch,
  filterByFields,
} from '@/lib/utils/client-utils';

export interface WebsitesTableProps {
  organizationId: string;
}

export function WebsitesTable({ organizationId }: WebsitesTableProps) {
  const { t: tTables } = useT('tables');
  const { t: tEmpty } = useT('emptyStates');
  const { t: tWebsites } = useT('websites');

  const { columns, searchPlaceholder, stickyLayout, pageSize } =
    useWebsitesTableConfig();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [displayCount, setDisplayCount] = useState(pageSize);

  const { results, status, loadMore, isLoading } = usePaginatedQuery(
    api.websites.queries.listWebsites,
    { organizationId },
    { initialNumItems: pageSize },
  );

  const processed = useMemo(() => {
    if (!results) return [];

    let data = [...results];

    if (search) {
      data = filterByTextSearch(data, search, ['domain', 'title', 'description']);
    }

    if (statusFilter.length > 0) {
      data = filterByFields(data, [
        { field: 'status', values: new Set(statusFilter) },
      ]);
    }

    return data;
  }, [results, search, statusFilter]);

  const displayedWebsites = useMemo(
    () => processed.slice(0, displayCount),
    [processed, displayCount],
  );

  const hasMore =
    displayCount < processed.length ||
    status === 'CanLoadMore' ||
    status === 'LoadingMore';

  const handleLoadMore = () => {
    if (displayCount >= processed.length && status === 'CanLoadMore') {
      loadMore(pageSize);
    }
    setDisplayCount((prev) => prev + pageSize);
  };

  const filterConfigs = useMemo(
    () => [
      {
        key: 'status',
        title: tTables('headers.status'),
        options: [
          { value: 'active', label: tWebsites('filter.status.active') },
          { value: 'scanning', label: tWebsites('filter.status.scanning') },
          { value: 'error', label: tWebsites('filter.status.error') },
        ],
        selectedValues: statusFilter,
        onChange: (values: string[]) => {
          setStatusFilter(values);
          setDisplayCount(pageSize);
        },
      },
    ],
    [statusFilter, pageSize, tTables, tWebsites],
  );

  const clearAll = () => {
    setSearch('');
    setStatusFilter([]);
    setDisplayCount(pageSize);
  };

  return (
    <DataTable
      columns={columns}
      data={displayedWebsites}
      getRowId={(row) => row._id}
      stickyLayout={stickyLayout}
      search={{
        value: search,
        onChange: (value) => {
          setSearch(value);
          setDisplayCount(pageSize);
        },
        placeholder: searchPlaceholder,
      }}
      filters={filterConfigs}
      onClearFilters={clearAll}
      actionMenu={<WebsitesActionMenu organizationId={organizationId} />}
      emptyState={{
        icon: Globe,
        title: tEmpty('websites.title'),
        description: tEmpty('websites.description'),
      }}
      infiniteScroll={{
        hasMore,
        onLoadMore: handleLoadMore,
        isLoadingMore: status === 'LoadingMore',
        isInitialLoading: status === 'LoadingFirstPage',
      }}
    />
  );
}

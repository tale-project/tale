'use client';

import { usePaginatedQuery } from 'convex/react';
import { Globe } from 'lucide-react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { useListPage } from '@/app/hooks/use-list-page';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import { useWebsitesTableConfig } from '../hooks/use-websites-table-config';
import { WebsitesActionMenu } from './websites-action-menu';

export interface WebsitesTableProps {
  organizationId: string;
}

export function WebsitesTable({ organizationId }: WebsitesTableProps) {
  const { t: tTables } = useT('tables');
  const { t: tEmpty } = useT('emptyStates');
  const { t: tWebsites } = useT('websites');

  const { columns, searchPlaceholder, stickyLayout, pageSize } =
    useWebsitesTableConfig();

  const paginatedResult = usePaginatedQuery(
    api.websites.queries.listWebsites,
    { organizationId },
    { initialNumItems: pageSize },
  );

  const list = useListPage({
    dataSource: { type: 'paginated', ...paginatedResult },
    pageSize,
    search: {
      fields: ['domain', 'title', 'description'],
      placeholder: searchPlaceholder,
    },
    filters: {
      definitions: [
        {
          key: 'status',
          title: tTables('headers.status'),
          options: [
            { value: 'active', label: tWebsites('filter.status.active') },
            { value: 'scanning', label: tWebsites('filter.status.scanning') },
            { value: 'error', label: tWebsites('filter.status.error') },
          ],
        },
      ],
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

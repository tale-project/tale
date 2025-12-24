'use client';

import { useState, useMemo } from 'react';
import { useQuery } from 'convex/react';
import { useSearchParams } from 'next/navigation';
import { Plus, Loader, Globe } from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';
import { api } from '@/convex/_generated/api';
import type { Doc } from '@/convex/_generated/dataModel';
import { DataTable, DataTableEmptyState } from '@/components/ui/data-table';
import { WebsiteIcon } from '@/components/ui/icons';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/utils/date/format';
import WebsiteRowActions from './website-row-actions';
import AddWebsiteDialog from './add-website-dialog';
import { useT, useLocale } from '@/lib/i18n';

interface WebsitesTableProps {
  organizationId: string;
  currentPage?: number;
  pageSize?: number;
}

export default function WebsitesTable({
  organizationId,
  currentPage = 1,
  pageSize = 10,
}: WebsitesTableProps) {
  const { t: tTables } = useT('tables');
  const { t: tEmpty } = useT('emptyStates');
  const { t: tWebsites } = useT('websites');
  const locale = useLocale();

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

  const searchParams = useSearchParams();
  const statusFilters = searchParams.get('status')?.split(',').filter(Boolean);

  // Fetch website data using Convex
  const result = useQuery(api.websites.getWebsites, {
    organizationId,
    paginationOpts: {
      numItems: pageSize,
      cursor: null,
    },
    status: statusFilters,
  });

  // Define columns using TanStack Table
  const columns = useMemo<ColumnDef<Doc<'websites'>>[]>(
    () => [
      {
        accessorKey: 'domain',
        header: tTables('headers.website'),
        size: 256,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <div className="flex-shrink-0 size-5 rounded flex items-center justify-center bg-muted">
              <WebsiteIcon className="size-3 text-muted-foreground" />
            </div>
            <span className="font-medium text-sm text-foreground truncate">
              {row.original.domain}
            </span>
          </div>
        ),
      },
      {
        accessorKey: 'title',
        header: tTables('headers.title'),
        size: 192,
        cell: ({ row }) => (
          <span className="text-sm text-foreground truncate">
            {row.original.title || tTables('cells.empty')}
          </span>
        ),
      },
      {
        accessorKey: 'description',
        header: tTables('headers.description'),
        size: 256,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground truncate">
            {row.original.description || tTables('cells.empty')}
          </span>
        ),
      },
      {
        accessorKey: 'lastScannedAt',
        header: tTables('headers.scanned'),
        size: 128,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.lastScannedAt ? (
              formatDate(new Date(row.original.lastScannedAt), {
                preset: 'short',
                locale,
              })
            ) : (
              <Loader className="size-4 animate-spin text-muted-foreground" />
            )}
          </span>
        ),
      },
      {
        accessorKey: 'scanInterval',
        header: tTables('headers.interval'),
        size: 96,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.scanInterval}
          </span>
        ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{tTables('headers.actions')}</span>,
        size: 128,
        cell: ({ row }) => (
          <div className="flex items-center justify-end">
            <WebsiteRowActions website={row.original} />
          </div>
        ),
      },
    ],
    [tTables],
  );

  if (result === undefined) {
    return null;
  }

  const websites = result.page;
  const hasActiveFilters = statusFilters && statusFilters.length > 0;
  const emptyWebsites = websites.length === 0 && !hasActiveFilters;

  const addButton = (
    <Button onClick={() => setIsAddDialogOpen(true)}>
      <Plus className="size-4 mr-1" />
      {tWebsites('addButton')}
    </Button>
  );

  // Show empty state when no websites and no filters
  if (emptyWebsites) {
    return (
      <>
        <DataTableEmptyState
          icon={Globe}
          title={tEmpty('websites.title')}
          description={tEmpty('websites.description')}
          action={addButton}
        />
        <AddWebsiteDialog
          isOpen={isAddDialogOpen}
          onClose={() => setIsAddDialogOpen(false)}
          organizationId={organizationId}
        />
      </>
    );
  }

  return (
    <>
      <AddWebsiteDialog
        isOpen={isAddDialogOpen}
        onClose={() => setIsAddDialogOpen(false)}
        organizationId={organizationId}
      />
      <DataTable
        columns={columns}
        data={websites}
        getRowId={(row) => row._id}
        header={
          <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-4">
            {addButton}
          </div>
        }
        pagination={{
          total: websites.length,
          pageSize,
          totalPages: Math.ceil(websites.length / pageSize),
          clientSide: true,
        }}
        currentPage={currentPage}
      />
    </>
  );
}

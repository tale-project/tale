'use client';

import { useState, useMemo } from 'react';
import { useQuery } from 'convex/react';
import { useSearchParams } from 'next/navigation';
import { Plus, Loader, Globe } from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';
import { api } from '@/convex/_generated/api';
import type { Doc } from '@/convex/_generated/dataModel';
import { DataTable, DataTableEmptyState } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/utils/date/format';
import WebsiteRowActions from './website-row-actions';
import AddWebsiteDialog from './add-website-dialog';

// Website icon component
const WebsiteIcon = () => (
  <div className="flex-shrink-0 size-5 rounded flex items-center justify-center bg-muted">
    <svg
      className="size-3 text-muted-foreground"
      fill="none"
      viewBox="0 0 16 16"
    >
      <path
        d="M2 4.5C2 3.67157 2.67157 3 3.5 3H12.5C13.3284 3 14 3.67157 14 4.5V11.5C14 12.3284 13.3284 13 12.5 13H3.5C2.67157 13 2 12.3284 2 11.5V4.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M2 6.5H14" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="4.5" cy="4.75" r="0.5" fill="currentColor" />
      <circle cx="6" cy="4.75" r="0.5" fill="currentColor" />
    </svg>
  </div>
);

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
        header: 'Website',
        size: 256,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <WebsiteIcon />
            <span className="font-medium text-sm text-foreground truncate">
              {row.original.domain}
            </span>
          </div>
        ),
      },
      {
        accessorKey: 'title',
        header: 'Title',
        size: 192,
        cell: ({ row }) => (
          <span className="text-sm text-foreground truncate">
            {row.original.title || '-'}
          </span>
        ),
      },
      {
        accessorKey: 'description',
        header: 'Description',
        size: 256,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground truncate">
            {row.original.description || '-'}
          </span>
        ),
      },
      {
        accessorKey: 'lastScannedAt',
        header: 'Scanned',
        size: 128,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.lastScannedAt ? (
              formatDate(new Date(row.original.lastScannedAt), {
                preset: 'long',
              })
            ) : (
              <Loader className="size-4 animate-spin text-muted-foreground" />
            )}
          </span>
        ),
      },
      {
        accessorKey: 'scanInterval',
        header: 'Interval',
        size: 96,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.scanInterval}
          </span>
        ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        size: 128,
        cell: ({ row }) => (
          <div className="flex items-center justify-end">
            <WebsiteRowActions website={row.original} />
          </div>
        ),
      },
    ],
    [],
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
      Add website
    </Button>
  );

  // Show empty state when no websites and no filters
  if (emptyWebsites) {
    return (
      <>
        <DataTableEmptyState
          icon={Globe}
          title="No websites yet"
          description="Add websites to make your AI smarter"
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

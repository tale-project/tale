'use client';

import { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import WebsiteRowActions from './website-row-actions';
import Pagination from '@/components/ui/pagination';
import { formatDate } from '@/lib/utils/date/format';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { cn } from '@/lib/utils/cn';
import { Button } from '@/components/ui/button';
import { Plus, Loader, Globe } from 'lucide-react';
import AddWebsiteDialog from './add-website-dialog';
import { useSearchParams } from 'next/navigation';

interface WebsitesTableProps {
  organizationId: string;
  currentPage?: number;
  pageSize?: number;
  queryParams?: string;
}

export default function WebsitesTable({
  organizationId,
  currentPage = 1,
  pageSize = 10,
  queryParams = '',
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

  if (result === undefined) {
    return null;
  }

  const websites = result.page;
  const pagination = {
    total: websites.length,
    page: currentPage,
    limit: pageSize,
    totalPages: Math.ceil(websites.length / pageSize),
  };

  const hasActiveFilters = statusFilters && statusFilters.length > 0;
  const emptyWebsites = websites.length === 0 && !hasActiveFilters;

  if (emptyWebsites) {
    return (
      <div className="grid place-items-center flex-[1_1_0] ring-1 ring-border rounded-xl p-4">
        <div className="text-center max-w-[24rem] flex flex-col items-center">
          <Globe className="size-6 text-secondary mb-5" />
          <div className="text-lg font-semibold leading-tight mb-2">
            No websites yet
          </div>
          <p className="text-sm text-muted-foreground mb-5">
            Add websites to make your AI smarter
          </p>
          <Button onClick={() => setIsAddDialogOpen(true)} className="gap-2">
            <Plus className="size-4" />
            Add website
          </Button>
        </div>

        <AddWebsiteDialog
          isOpen={isAddDialogOpen}
          onClose={() => setIsAddDialogOpen(false)}
          organizationId={organizationId}
        />
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-4 mb-4">
        <Button onClick={() => setIsAddDialogOpen(true)}>
          <Plus className="size-4 mr-1" />
          Add website
        </Button>
      </div>

      <AddWebsiteDialog
        isOpen={isAddDialogOpen}
        onClose={() => setIsAddDialogOpen(false)}
        organizationId={organizationId}
      />

      <div className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[16rem] font-medium text-sm">
                Website
              </TableHead>
              <TableHead className="w-[12rem] font-medium text-sm">
                Title
              </TableHead>
              <TableHead className="w-[16rem] font-medium text-sm">
                Description
              </TableHead>
              <TableHead className="w-[8rem] font-medium text-sm">
                Scanned
              </TableHead>
              <TableHead className="w-[6rem] font-medium text-sm">
                Interval
              </TableHead>
              <TableHead className="w-[8rem] text-right font-medium text-sm text-foreground">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {websites.map((website, index) => (
              <TableRow
                key={website._id}
                className={cn(
                  'group bg-background',
                  index === websites.length - 1
                    ? 'border-b-0'
                    : 'border-b border-border',
                )}
              >
                <TableCell className="w-[16rem] h-[60px]">
                  <div className="flex items-center gap-2">
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
                        <path
                          d="M2 6.5H14"
                          stroke="currentColor"
                          strokeWidth="1.5"
                        />
                        <circle
                          cx="4.5"
                          cy="4.75"
                          r="0.5"
                          fill="currentColor"
                        />
                        <circle cx="6" cy="4.75" r="0.5" fill="currentColor" />
                      </svg>
                    </div>
                    <span className="font-medium text-sm text-foreground truncate">
                      {website.domain}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="w-[12rem] text-sm text-foreground truncate">
                  {website.title || '-'}
                </TableCell>
                <TableCell className="w-[16rem] text-xs text-muted-foreground truncate">
                  {website.description || '-'}
                </TableCell>
                <TableCell className="w-[8rem] text-xs text-muted-foreground">
                  {website.lastScannedAt ? (
                    formatDate(new Date(website.lastScannedAt), {
                      preset: 'long',
                    })
                  ) : (
                    <Loader className="size-4 animate-spin text-muted-foreground" />
                  )}
                </TableCell>
                <TableCell className="w-[6rem] text-xs text-muted-foreground">
                  {website.scanInterval}
                </TableCell>
                <TableCell className="w-[8rem] py-2">
                  <div className="flex items-center justify-end">
                    <WebsiteRowActions website={website} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {websites.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center py-10 text-muted-foreground bg-background"
                >
                  No websites found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <Pagination
          currentPage={pagination.page}
          totalPages={pagination.totalPages}
          total={pagination.total}
          pageSize={pageSize}
          queryString={queryParams}
        />
      </div>
    </>
  );
}

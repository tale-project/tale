'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import VendorRowActions from './vendor-row-actions';
import Pagination from '@/components/ui/pagination';
import { startCase } from 'lodash';
import { formatDate } from '@/lib/utils/date/format';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import VendorFilter from './vendor-filter';
import VendorSearch from './vendor-search';
import { cn } from '@/lib/utils/cn';
import { Store } from 'lucide-react';
import ImportVendorsMenu from './import-vendors-menu';
import { useSearchParams } from 'next/navigation';

interface VendorsTableProps {
  organizationId: string;
  currentPage?: number;
  pageSize?: number;
  searchTerm?: string;
  queryParams?: string;
}

export default function VendorsTable({
  organizationId,
  currentPage = 1,
  pageSize = 10,
  searchTerm,
  queryParams = '',
}: VendorsTableProps) {
  const searchParams = useSearchParams();
  const sourceFilters = searchParams.get('source')?.split(',').filter(Boolean);
  const localeFilters = searchParams.get('locale')?.split(',').filter(Boolean);

  // Fetch vendor data using Convex (vendors are vendors with specific filtering)
  const result = useQuery(api.vendors.getVendors, {
    organizationId,
    paginationOpts: {
      numItems: pageSize,
      cursor: null, // For now, we'll implement simple pagination
    },
    source: sourceFilters,
    locale: localeFilters,
    searchTerm,
  });

  if (result === undefined) {
    return null;
  }

  const vendors = result.page;
  const pagination = {
    total: vendors.length, // This is a simplified approach
    page: currentPage,
    limit: pageSize,
    totalPages: Math.ceil(vendors.length / pageSize),
  };

  const hasActiveFilters =
    searchTerm ||
    (sourceFilters && sourceFilters.length > 0) ||
    (localeFilters && localeFilters.length > 0);
  const emptyVendors = vendors.length === 0 && !hasActiveFilters;

  if (emptyVendors) {
    return (
      <div className="grid place-items-center flex-[1_1_0] ring-1 ring-border rounded-xl p-4">
        <div className="text-center max-w-[24rem] flex flex-col items-center">
          <Store className="size-6 text-secondary mb-5" />
          <div className="text-lg font-semibold leading-tight mb-2">
            No vendors yet
          </div>
          <p className="text-sm text-muted-foreground mb-5">
            Upload your first vendor to get started
          </p>
          <ImportVendorsMenu organizationId={organizationId} />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <VendorSearch
            organizationId={organizationId}
            currentSearch={searchTerm}
          />
          <VendorFilter />
        </div>
        <ImportVendorsMenu organizationId={organizationId} />
      </div>

      <div className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[25.5rem] font-medium text-sm">
                Name
              </TableHead>
              <TableHead className="w-[8.75rem] font-medium text-sm">
                Source
              </TableHead>
              <TableHead className="w-[6.25rem] font-medium text-sm">
                <svg className="size-4" fill="none" viewBox="0 0 20 20">
                  <path
                    d="M7.25 16L11.625 6.625L16 16M8.5 13.5H14.75M1 3.18447C2.63797 2.98022 4.3067 2.875 6 2.875M6 2.875C6.93401 2.875 7.86054 2.90701 8.77856 2.97M6 2.875V1M8.77856 2.97C7.81361 7.38151 4.90723 11.0668 1 13.0852M8.77856 2.97C9.52485 3.0212 10.2655 3.09288 11 3.18447M7.17606 10.2635C5.82129 8.88493 4.73087 7.24575 3.98694 5.42805"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.5"
                  />
                </svg>
              </TableHead>
              <TableHead className="w-[8.75rem] font-medium text-sm text-right">
                Created
              </TableHead>
              <TableHead className="w-[8.75rem] text-right font-medium text-sm text-foreground">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vendors.map((vendor, index) => (
              <TableRow
                key={vendor._id}
                className={cn(
                  'group bg-background',
                  index === vendors.length - 1
                    ? 'border-b-0'
                    : 'border-b border-border',
                )}
              >
                <TableCell className="w-[25.5rem] h-[60px]">
                  <div className="flex flex-col gap-1">
                    <span className="font-medium text-sm text-foreground">
                      {vendor.name || ''}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {vendor.email || 'No email'}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="w-[8.75rem] text-xs text-muted-foreground">
                  {vendor.source
                    ? startCase(vendor.source.toLowerCase())
                    : 'Unknown'}
                </TableCell>
                <TableCell className="w-[6.25rem] text-xs text-muted-foreground">
                  {vendor.locale
                    ? vendor.locale.toUpperCase().slice(0, 2)
                    : 'En'}
                </TableCell>
                <TableCell className="w-[8.75rem] text-xs text-muted-foreground text-right">
                  {formatDate(new Date(vendor._creationTime), {
                    preset: 'short',
                  })}
                </TableCell>
                <TableCell className="w-[8.75rem] py-2">
                  <div className="flex items-center justify-end">
                    <VendorRowActions vendor={vendor} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {vendors.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center py-10 text-muted-foreground bg-background"
                >
                  No vendors found
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

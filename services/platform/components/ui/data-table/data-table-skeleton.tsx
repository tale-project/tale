'use client';

import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Stack, HStack } from '@/components/ui/layout';
import { cn } from '@/lib/utils/cn';

export interface DataTableSkeletonColumn {
  /** Header label (optional) */
  header?: string;
  /** Width in pixels (should match the actual DataTable column size) */
  size?: number;
  /** Whether this is an action column (shows icon skeleton) */
  isAction?: boolean;
}

export interface DataTableSkeletonProps {
  /** Number of rows to display */
  rows?: number;
  /** Column configuration - should match the actual DataTable columns */
  columns: DataTableSkeletonColumn[];
  /** Whether to show the header row */
  showHeader?: boolean;
  /** Whether to show the filter bar skeleton */
  showFilters?: boolean;
  /** Custom header content - takes precedence over showFilters */
  customHeader?: React.ReactNode;
  /** Whether to show the pagination skeleton */
  showPagination?: boolean;
  /** Additional class name */
  className?: string;
}

/**
 * Loading skeleton for DataTable.
 *
 * Matches the DataTable layout to prevent CLS during loading.
 * Uses w-full to match the responsive width of the actual DataTable.
 */
export function DataTableSkeleton({
  rows = 5,
  columns,
  showHeader = true,
  showFilters = false,
  customHeader,
  showPagination = false,
  className,
}: DataTableSkeletonProps) {
  return (
    <Stack gap={4} className={cn('w-full', className)}>
      {customHeader
        ? customHeader
        : showFilters && (
            <HStack gap={3}>
              <Skeleton className="h-10 w-full max-w-[18.75rem]" />
              <Skeleton className="h-10 w-24" />
            </HStack>
          )}

      <Table>
        {showHeader && (
          <TableHeader>
            <TableRow className="bg-secondary/20">
              {columns.map((col, i) => (
                <TableHead
                  key={i}
                  className="font-medium text-sm"
                  style={col.size ? { width: col.size } : undefined}
                >
                  {col.header ?? <Skeleton className="h-4 w-20" />}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
        )}
        <TableBody>
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <TableRow key={rowIndex}>
              {columns.map((col, colIndex) => (
                <TableCell
                  key={colIndex}
                  style={col.size ? { width: col.size } : undefined}
                  className="h-[52px]"
                >
                  {col.isAction ? (
                    <HStack justify="end">
                      <Skeleton className="h-8 w-8 rounded-md" />
                    </HStack>
                  ) : colIndex === 0 ? (
                    <HStack gap={3}>
                      <Skeleton className="size-8 rounded-md shrink-0" />
                      <Stack gap={1} className="flex-1">
                        <Skeleton className="h-4 w-full max-w-48" />
                        <Skeleton className="h-3 w-2/3 max-w-24" />
                      </Stack>
                    </HStack>
                  ) : (
                    <Skeleton className="h-4 w-full" />
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {showPagination && (
        <HStack gap={2}>
          <Skeleton className="h-8 w-8" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-8" />
          <Skeleton className="h-4 w-24" />
        </HStack>
      )}
    </Stack>
  );
}

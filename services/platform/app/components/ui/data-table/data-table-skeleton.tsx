'use client';

import type { ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/app/components/ui/data-display/table';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { DataTablePagination } from './data-table-pagination';
import { cn } from '@/lib/utils/cn';

/** Skeleton type for different cell content patterns */
type SkeletonType = 'text' | 'badge' | 'id-copy' | 'avatar-text' | 'action';

interface DataTableSkeletonColumn {
  /** Header label (optional) */
  header?: string;
  /** Width in pixels (should match the actual DataTable column size) */
  size?: number;
  /** Whether this is an action column (shows icon skeleton) */
  isAction?: boolean;
  /** Whether this column should show avatar+text layout */
  hasAvatar?: boolean;
  /** Column alignment (header and cell content) */
  align?: 'left' | 'center' | 'right';
  /** Skeleton configuration for this column */
  skeleton?: {
    type?: SkeletonType;
  };
  /** Internal: marks this as the expand column placeholder */
  isExpandColumn?: boolean;
}

export interface DataTableSkeletonProps {
  /** Number of rows to display */
  rows?: number;
  /** Column configuration - accepts TanStack Table columns or simple column config */
  columns: DataTableSkeletonColumn[] | ColumnDef<any, any>[];
  /** Whether to show the header row */
  showHeader?: boolean;
  /** Search placeholder for search input skeleton */
  searchPlaceholder?: string;
  /** Action menu element to render in the header */
  actionMenu?: ReactNode;
  /** Whether to show the pagination skeleton (for offset-based pagination) */
  showPagination?: boolean;
  /** Page size for pagination display */
  pageSize?: number;
  /** Additional class name */
  className?: string;
  /** Disable default avatar layout for first column */
  noFirstColumnAvatar?: boolean;
  /** Enable sticky layout mode */
  stickyLayout?: boolean;
  /** Enable infinite scroll skeleton (for cursor-based pagination) */
  infiniteScroll?: boolean;
  /** Show filter button skeleton */
  showFilters?: boolean;
  /** Show date range picker skeleton */
  showDateRange?: boolean;
  /** Enable expanding row indicator column (matches DataTable enableExpanding) */
  enableExpanding?: boolean;
}

interface ColumnMeta {
  isAction?: boolean;
  hasAvatar?: boolean;
  skeleton?: { type?: SkeletonType };
}

/** Extract skeleton column info from TanStack Table column definitions */
function normalizeColumns(
  columns: DataTableSkeletonColumn[] | ColumnDef<any, any>[],
  enableExpanding?: boolean,
): DataTableSkeletonColumn[] {
  const normalized = columns.map((col) => {
    // Check if it's already a simple column config
    if ('isAction' in col || 'hasAvatar' in col || 'align' in col || 'skeleton' in col) {
      return col as DataTableSkeletonColumn;
    }

    // Convert TanStack Table column definition
    const tanstackCol = col as ColumnDef<unknown, unknown>;
    const meta = tanstackCol.meta as ColumnMeta | undefined;
    return {
      header:
        typeof tanstackCol.header === 'string' ? tanstackCol.header : undefined,
      size: 'size' in tanstackCol ? (tanstackCol.size as number) : undefined,
      isAction: meta?.isAction,
      hasAvatar: meta?.hasAvatar,
      skeleton: meta?.skeleton,
    };
  });

  // Prepend expand column if enabled
  if (enableExpanding) {
    return [{ isExpandColumn: true, size: 48 }, ...normalized];
  }

  return normalized;
}

/**
 * Loading skeleton for DataTable.
 *
 * Matches the DataTable layout to prevent CLS during loading.
 * Accepts TanStack Table column definitions directly for consistent column widths.
 */
export function DataTableSkeleton({
  rows = 10,
  columns,
  showHeader = true,
  searchPlaceholder,
  actionMenu,
  showPagination = true,
  pageSize = 10,
  className,
  noFirstColumnAvatar = false,
  stickyLayout = false,
  infiniteScroll = false,
  showFilters = false,
  showDateRange = false,
  enableExpanding = false,
}: DataTableSkeletonProps) {
  const normalizedColumns = normalizeColumns(columns, enableExpanding);

  const tableContent = (
    <Table stickyLayout={stickyLayout}>
      {showHeader && (
        <TableHeader sticky={stickyLayout}>
          <TableRow className="bg-secondary/20">
            {normalizedColumns.map((col, i) => (
              <TableHead
                key={i}
                className={cn(
                  'font-medium text-sm text-muted-foreground',
                  col.isExpandColumn && 'w-[3rem]',
                  col.align === 'right' && 'text-right',
                  col.align === 'center' && 'text-center',
                )}
                style={col.size && !col.isExpandColumn ? { width: col.size } : undefined}
              >
                {col.isExpandColumn || col.isAction
                  ? null
                  : (col.header ?? <Skeleton className="h-3.5 w-20" />)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
      )}
      <TableBody>
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <TableRow key={rowIndex}>
            {normalizedColumns.map((col, colIndex) => {
              // Handle expand column
              if (col.isExpandColumn) {
                return (
                  <TableCell key={colIndex} className="w-[3rem]">
                    <Skeleton className="size-4" />
                  </TableCell>
                );
              }

              // Determine actual column index (accounting for expand column)
              const actualColIndex = enableExpanding ? colIndex - 1 : colIndex;
              const showAvatar =
                col.hasAvatar === true ||
                (!noFirstColumnAvatar &&
                  actualColIndex === 0 &&
                  col.hasAvatar !== false);

              // Determine skeleton type from column meta
              const skeletonType = col.skeleton?.type;

              let cellContent: React.ReactNode;

              if (col.isAction || skeletonType === 'action') {
                cellContent = (
                  <HStack justify="end">
                    <Skeleton className="h-8 w-8 rounded-md" />
                  </HStack>
                );
              } else if (skeletonType === 'badge') {
                cellContent = <Skeleton className="h-5 w-20 rounded-full" />;
              } else if (skeletonType === 'id-copy') {
                cellContent = (
                  <HStack gap={2}>
                    <Skeleton className="h-3.5 flex-1 max-w-[120px]" />
                    <Skeleton className="size-6 rounded-md shrink-0" />
                  </HStack>
                );
              } else if (showAvatar || skeletonType === 'avatar-text') {
                cellContent = (
                  <HStack gap={3}>
                    <Skeleton className="size-8 rounded-md shrink-0" />
                    <Stack gap={1} className="flex-1">
                      <Skeleton className="h-3.5 w-full max-w-48" />
                      <Skeleton className="h-3 w-2/3 max-w-24" />
                    </Stack>
                  </HStack>
                );
              } else if (col.align === 'right') {
                cellContent = (
                  <div className="flex justify-end">
                    <Skeleton className="h-3.5 w-20" />
                  </div>
                );
              } else if (col.align === 'center') {
                cellContent = (
                  <div className="flex justify-center">
                    <Skeleton className="h-3.5 w-20" />
                  </div>
                );
              } else {
                cellContent = <Skeleton className="h-3.5 w-full max-w-[80%]" />;
              }

              return (
                <TableCell
                  key={colIndex}
                  style={col.size ? { width: col.size } : undefined}
                >
                  {cellContent}
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  // Build header content with search skeleton and action menu
  const hasHeader =
    searchPlaceholder || showFilters || showDateRange || actionMenu;
  const headerContent = hasHeader ? (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div className="flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center gap-3 w-full sm:w-auto">
        <HStack gap={3} className="w-full sm:w-auto">
          {searchPlaceholder && (
            <Skeleton className="h-9 flex-1 sm:flex-none sm:w-[18.75rem]" />
          )}
          {showFilters && <Skeleton className="h-9 w-9 rounded-md shrink-0" />}
        </HStack>
        {showDateRange && <Skeleton className="h-9 w-[15rem]" />}
      </div>
      {actionMenu}
    </div>
  ) : null;

  // Pagination content for offset-based pagination
  const paginationContent = showPagination && !infiniteScroll && (
    <DataTablePagination
      currentPage={1}
      total={0}
      pageSize={pageSize}
      totalPages={1}
      isLoading
    />
  );

  // Infinite scroll content (load more button skeleton) for cursor-based pagination
  const infiniteScrollContent = infiniteScroll && (
    <div className="flex justify-center py-3 border-t border-border">
      <Skeleton className="h-9 w-24" />
    </div>
  );

  // For sticky layout, use flex structure matching DataTable
  if (stickyLayout) {
    return (
      <div className={cn('flex flex-col flex-1 min-h-0', className)}>
        {headerContent && (
          <div className="shrink-0 pb-4">{headerContent}</div>
        )}
        <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-border">
          {tableContent}
          {infiniteScrollContent}
        </div>
        {paginationContent && (
          <div className="shrink-0 pt-6">{paginationContent}</div>
        )}
      </div>
    );
  }

  return (
    <Stack gap={4} className={cn('w-full', className)}>
      {headerContent}
      <div className="rounded-xl border border-border">
        {tableContent}
        {infiniteScrollContent}
      </div>
      {paginationContent}
    </Stack>
  );
}

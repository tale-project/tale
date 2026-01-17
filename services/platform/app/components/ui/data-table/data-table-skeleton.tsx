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
}

/** Extract skeleton column info from TanStack Table column definitions */
function normalizeColumns(
  columns: DataTableSkeletonColumn[] | ColumnDef<any, any>[],
): DataTableSkeletonColumn[] {
  return columns.map((col) => {
    // Check if it's already a simple column config
    if ('isAction' in col || 'hasAvatar' in col || 'align' in col) {
      return col as DataTableSkeletonColumn;
    }

    // Convert TanStack Table column definition
    const tanstackCol = col as ColumnDef<unknown, unknown>;
    return {
      header:
        typeof tanstackCol.header === 'string' ? tanstackCol.header : undefined,
      size: 'size' in tanstackCol ? (tanstackCol.size as number) : undefined,
      isAction: (tanstackCol.meta as { isAction?: boolean } | undefined)
        ?.isAction,
      hasAvatar: (tanstackCol.meta as { hasAvatar?: boolean } | undefined)
        ?.hasAvatar,
    };
  });
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
}: DataTableSkeletonProps) {
  const normalizedColumns = normalizeColumns(columns);

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
                  col.align === 'right' && 'text-right',
                  col.align === 'center' && 'text-center',
                )}
                style={col.size ? { width: col.size } : undefined}
              >
                {col.isAction
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
              const showAvatar =
                col.hasAvatar === true ||
                (!noFirstColumnAvatar &&
                  colIndex === 0 &&
                  col.hasAvatar !== false);

              const cellContent = col.isAction ? (
                <HStack justify="end">
                  <Skeleton className="h-8 w-8 rounded-md" />
                </HStack>
              ) : showAvatar ? (
                <HStack gap={3}>
                  <Skeleton className="size-8 rounded-md shrink-0" />
                  <Stack gap={1} className="flex-1">
                    <Skeleton className="h-3.5 w-full max-w-48" />
                    <Skeleton className="h-3 w-2/3 max-w-24" />
                  </Stack>
                </HStack>
              ) : col.align === 'right' ? (
                <div className="flex justify-end">
                  <Skeleton className="h-3.5 w-20" />
                </div>
              ) : col.align === 'center' ? (
                <div className="flex justify-center">
                  <Skeleton className="h-3.5 w-20" />
                </div>
              ) : (
                <Skeleton className="h-3.5 w-full max-w-[80%]" />
              );

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
  const hasHeader = searchPlaceholder || actionMenu;
  const headerContent = hasHeader ? (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      {searchPlaceholder ? (
        <HStack gap={3}>
          <Skeleton className="h-9 w-[18.75rem]" />
        </HStack>
      ) : (
        <div />
      )}
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
          <div className="flex-shrink-0 pb-4">{headerContent}</div>
        )}
        <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-border">
          {tableContent}
          {infiniteScrollContent}
        </div>
        {paginationContent && (
          <div className="flex-shrink-0 pt-6">{paginationContent}</div>
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

'use client';

import type { ColumnDef } from '@tanstack/react-table';
import type { ReactNode } from 'react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/app/components/ui/data-display/table';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { cn } from '@/lib/utils/cn';

/** Skeleton type for different cell content patterns */
type SkeletonType =
  | 'text'
  | 'badge'
  | 'id-copy'
  | 'avatar-text'
  | 'action'
  | 'switch';

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

export interface DataTableSkeletonProps<TData = unknown, TValue = unknown> {
  /** Number of rows to display */
  rows?: number;
  /** Column configuration - accepts TanStack Table columns or simple column config */
  columns: DataTableSkeletonColumn[] | ColumnDef<TData, TValue>[];
  /** Whether to show the header row */
  showHeader?: boolean;
  /** Search placeholder for search input skeleton */
  searchPlaceholder?: string;
  /** Action menu element to render in the header */
  actionMenu?: ReactNode;
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
  headerLabel?: string;
}

/** Extract skeleton column info from TanStack Table column definitions */
function normalizeColumns<TData, TValue>(
  columns: DataTableSkeletonColumn[] | ColumnDef<TData, TValue>[],
  enableExpanding?: boolean,
): DataTableSkeletonColumn[] {
  const normalized = columns.map((col) => {
    // Check if it's already a simple column config
    if (
      'isAction' in col ||
      'hasAvatar' in col ||
      'align' in col ||
      'skeleton' in col
    ) {
      return col;
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ColumnDef.meta is typed as unknown by TanStack Table
    const meta = (col as ColumnDef<TData, TValue>).meta as
      | ColumnMeta
      | undefined;
    return {
      header: typeof col.header === 'string' ? col.header : meta?.headerLabel,
      size: col.size,
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
export function DataTableSkeleton<TData = unknown, TValue = unknown>({
  rows = 10,
  columns,
  showHeader = true,
  searchPlaceholder,
  actionMenu,
  className,
  noFirstColumnAvatar = false,
  stickyLayout = false,
  infiniteScroll = false,
  showFilters = false,
  showDateRange = false,
  enableExpanding = false,
}: DataTableSkeletonProps<TData, TValue>) {
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
                style={
                  col.size && !col.isExpandColumn
                    ? { width: col.size }
                    : undefined
                }
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
              } else if (skeletonType === 'switch') {
                cellContent = (
                  <Skeleton className="h-[1.15rem] w-8 rounded-full" />
                );
              } else if (skeletonType === 'id-copy') {
                cellContent = (
                  <HStack gap={2}>
                    <Skeleton className="h-3.5 max-w-[120px] flex-1" />
                    <Skeleton className="size-6 shrink-0 rounded-md" />
                  </HStack>
                );
              } else if (showAvatar || skeletonType === 'avatar-text') {
                cellContent = (
                  <HStack gap={3}>
                    <Skeleton className="size-8 shrink-0 rounded-md" />
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
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
      <div className="flex w-full flex-col items-start gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
        <HStack gap={3} className="w-full sm:w-auto">
          {searchPlaceholder && (
            <Skeleton className="h-9 flex-1 sm:w-[18.75rem] sm:flex-none" />
          )}
          {showFilters && <Skeleton className="h-9 w-9 shrink-0 rounded-md" />}
        </HStack>
        {showDateRange && <Skeleton className="h-9 w-[15rem]" />}
      </div>
      {actionMenu}
    </div>
  ) : null;

  // Infinite scroll content (load more button skeleton) for cursor-based pagination
  const infiniteScrollContent = infiniteScroll && (
    <div className="border-border flex justify-center border-t py-3">
      <Skeleton className="h-9 w-24" />
    </div>
  );

  // For sticky layout, use flex structure matching DataTable
  if (stickyLayout) {
    return (
      <div className={cn('flex flex-col flex-1 min-h-0', className)}>
        {headerContent && <div className="shrink-0 pb-4">{headerContent}</div>}
        <div className="border-border min-h-0 flex-1 overflow-auto rounded-xl border">
          {tableContent}
          {infiniteScrollContent}
        </div>
      </div>
    );
  }

  return (
    <Stack gap={4} className={cn('w-full', className)}>
      {headerContent}
      <div className="border-border overflow-hidden rounded-xl border">
        {tableContent}
        {infiniteScrollContent}
      </div>
    </Stack>
  );
}

'use client';

import type { DateRange } from 'react-day-picker';

import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
  type SortingState,
  type ExpandedState,
  type RowSelectionState,
  type OnChangeFn,
  type PaginationState,
} from '@tanstack/react-table';
import { ChevronRight } from 'lucide-react';
import {
  Fragment,
  useState,
  useRef,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';

import type { DatePreset } from '@/app/components/ui/forms/date-range-picker';

import { ErrorBoundaryBase } from '@/app/components/error-boundaries/core/error-boundary-base';
import { ErrorDisplayCompact } from '@/app/components/error-boundaries/displays/error-display-compact';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/app/components/ui/data-display/table';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Spinner } from '@/app/components/ui/feedback/spinner';
import { HStack, Stack, VStack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { useInfiniteScroll } from '@/app/hooks/use-infinite-scroll';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type {
  DataTableSearchConfig,
  DataTableSortingConfig,
} from './data-table-types';

import {
  DataTableEmptyState,
  type DataTableEmptyStateProps,
} from './data-table-empty-state';
import { DataTableFilters, type FilterConfig } from './data-table-filters';
import {
  DataTablePagination,
  type DataTablePaginationProps,
} from './data-table-pagination';

export interface DataTableProps<TData, TValue = unknown> {
  /** Column definitions */
  columns: ColumnDef<TData, TValue>[];
  /** Data to display */
  data: TData[];
  /** Accessible table caption for screen readers */
  caption?: string;
  /** Empty state configuration (actionMenu is automatically provided) */
  emptyState?: Omit<DataTableEmptyStateProps, 'actionMenu'>;
  /** Pagination configuration */
  pagination?: Omit<DataTablePaginationProps, 'currentPage'> & {
    /** Whether to use client-side pagination */
    clientSide?: boolean;
  };
  /** Current page (1-based, for server-side pagination) */
  currentPage?: number;
  /** Infinite scroll configuration (for cursor-based pagination) */
  infiniteScroll?: {
    /** Whether there are more items to load */
    hasMore: boolean;
    /** Callback to load more items */
    onLoadMore: () => void;
    /** Whether more items are currently loading */
    isLoadingMore?: boolean;
    /** Whether initial data is loading (prevents empty state flash) */
    isInitialLoading?: boolean;
    /** Enable automatic loading on scroll (default: true) */
    autoLoad?: boolean;
    /** Distance from bottom to trigger load in px (default: 1000) */
    threshold?: number;
  };
  /** Number of skeleton rows during initial loading (default: 10) */
  skeletonRows?: number;
  /** Sorting configuration from useDataTable hook */
  sorting?: DataTableSortingConfig;
  /** Enable row selection */
  enableRowSelection?: boolean;
  /** Row selection state (controlled) */
  rowSelection?: RowSelectionState;
  /** Callback when row selection changes */
  onRowSelectionChange?: OnChangeFn<RowSelectionState>;
  /** Enable expandable rows */
  enableExpanding?: boolean;
  /** Render function for expanded row content */
  renderExpandedRow?: (row: Row<TData>) => ReactNode;
  /** Get row ID for selection/expansion */
  getRowId?: (row: TData) => string;
  /** Additional class name for the table container */
  className?: string;
  /** Additional class name for table rows */
  rowClassName?: string | ((row: Row<TData>) => string);
  /** Callback when a row is clicked */
  onRowClick?: (row: Row<TData>) => void;
  /** Whether rows are clickable (adds cursor pointer) */
  clickableRows?: boolean;

  // ============================================================================
  // Header configuration
  // ============================================================================

  /** Search configuration */
  search?: DataTableSearchConfig;
  /** Filter configurations */
  filters?: FilterConfig[];
  /** Date range filter configuration */
  dateRange?: {
    from?: Date;
    to?: Date;
    onChange: (range: DateRange | undefined) => void;
    presets?: DatePreset[];
  };
  /** Whether filters are loading */
  isFiltersLoading?: boolean;
  /** Callback to clear all filters */
  onClearFilters?: () => void;
  /** Header action menu element (use DataTableActionMenu component) */
  actionMenu?: ReactNode;
  /** Footer content */
  footer?: ReactNode;
  /** Enable sticky layout with header at top and pagination at bottom */
  stickyLayout?: boolean;
  /** Error from query, if any */
  error?: Error | null;
  /** Callback when retry is clicked */
  onRetry?: () => void;
}

/**
 * Unified DataTable component using TanStack Table.
 *
 * Features:
 * - Column definitions via TanStack Table
 * - Sorting (client-side or server-side)
 * - Row selection with checkboxes
 * - Expandable rows
 * - Pagination (client-side or server-side)
 * - Empty states (initial and filtered)
 * - Loading skeletons
 * - Customizable row actions
 */
export function DataTable<TData, TValue = unknown>({
  columns,
  data,
  caption,
  emptyState,
  pagination,
  currentPage = 1,
  sorting: sortingConfig,
  enableRowSelection = false,
  rowSelection: controlledRowSelection,
  onRowSelectionChange,
  enableExpanding = false,
  renderExpandedRow,
  getRowId,
  className,
  rowClassName,
  onRowClick,
  clickableRows = false,
  // Header configuration props
  search,
  filters,
  dateRange,
  isFiltersLoading = false,
  onClearFilters,
  actionMenu,
  footer,
  stickyLayout = false,
  infiniteScroll,
  skeletonRows = 10,
  error,
  onRetry,
}: DataTableProps<TData, TValue>) {
  const { t } = useT('common');
  const orgId = useOrganizationId();

  // Extract sorting config - presence of sortingConfig enables sorting
  const enableSorting = !!sortingConfig;
  const initialSorting = sortingConfig?.initialSorting ?? [];
  const onSortingChange = sortingConfig?.onSortingChange;

  // Internal state for uncontrolled modes - must be called before any early returns
  const [internalSorting, setInternalSorting] =
    useState<SortingState>(initialSorting);
  const [internalRowSelection, setInternalRowSelection] =
    useState<RowSelectionState>({});
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [internalPagination, setInternalPagination] = useState<PaginationState>(
    {
      pageIndex: currentPage - 1,
      pageSize: pagination?.pageSize ?? 10,
    },
  );

  // Ref to the scroll container for sticky layout (needed for IntersectionObserver root)
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Track previous row count for animation on load more
  const prevRowCountRef = useRef(0);
  const [animatingRows, setAnimatingRows] = useState<Set<string>>(new Set());

  // Stable noop callback for when infiniteScroll is not provided
  const noop = useCallback(() => {}, []);

  useEffect(() => {
    const currentCount = data.length;
    if (currentCount > prevRowCountRef.current && prevRowCountRef.current > 0) {
      // New rows were added, mark them for animation
      const newRowIds = new Set(
        data.slice(prevRowCountRef.current).map((row) => getRowId?.(row) ?? ''),
      );
      setAnimatingRows(newRowIds);
      // Clear animation flags after animation completes
      const timer = setTimeout(() => {
        setAnimatingRows(new Set());
      }, 300);
      prevRowCountRef.current = currentCount;
      return () => clearTimeout(timer);
    }
    prevRowCountRef.current = currentCount;
  }, [data, getRowId]);

  // Initialize infinite scroll hook for automatic loading
  const { sentinelRef } = useInfiniteScroll({
    onLoadMore: infiniteScroll?.onLoadMore ?? noop,
    hasMore: infiniteScroll?.hasMore ?? false,
    isLoading: infiniteScroll?.isLoadingMore ?? false,
    threshold: infiniteScroll?.threshold ?? 1000,
    enabled: !!(infiniteScroll && infiniteScroll.autoLoad !== false),
    root: stickyLayout ? scrollContainerRef : undefined,
  });

  // Use controlled or internal state
  const sorting = onSortingChange ? initialSorting : internalSorting;
  const rowSelection = controlledRowSelection ?? internalRowSelection;

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      rowSelection,
      expanded,
      ...(pagination?.clientSide && { pagination: internalPagination }),
    },
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    ...(enableSorting && {
      getSortedRowModel: getSortedRowModel(),
      onSortingChange: onSortingChange ?? setInternalSorting,
    }),
    ...(enableRowSelection && {
      enableRowSelection: true,
      onRowSelectionChange: onRowSelectionChange ?? setInternalRowSelection,
    }),
    ...(enableExpanding && {
      getExpandedRowModel: getExpandedRowModel(),
      onExpandedChange: setExpanded,
    }),
    ...(pagination?.clientSide && {
      getPaginationRowModel: getPaginationRowModel(),
      onPaginationChange: setInternalPagination,
    }),
  });

  // If error prop provided, show error display instead of table
  if (error) {
    return (
      <ErrorDisplayCompact
        error={error}
        organizationId={orgId}
        reset={onRetry || (() => {})}
      />
    );
  }

  // Determine if we should render header
  const hasHeader =
    search || (filters && filters.length > 0) || dateRange || actionMenu;

  // Build the header content
  const headerContent = hasHeader ? (
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
      <DataTableFilters
        search={search}
        filters={filters}
        dateRange={dateRange}
        isLoading={isFiltersLoading}
        onClearAll={onClearFilters}
      />
      {actionMenu}
    </div>
  ) : null;

  // Check if any filters are actively applied (moved here after hooks)
  const hasActiveFilters =
    (search?.value && search.value.trim().length > 0) ||
    (filters && filters.some((f) => f.selectedValues.length > 0)) ||
    dateRange?.from ||
    dateRange?.to;

  // Determine empty state (but not during initial load)
  const isInitialLoading = infiniteScroll?.isInitialLoading;
  const showEmptyState = data.length === 0 && emptyState && !isInitialLoading;
  const showInitialEmptyState = showEmptyState && !hasActiveFilters;

  // Initial empty state (no data, no filters) - early return since no header needed
  if (showInitialEmptyState) {
    return (
      <div
        className={cn(
          stickyLayout ? 'flex flex-col flex-1 min-h-0' : 'space-y-4',
          className,
        )}
      >
        <DataTableEmptyState {...emptyState} actionMenu={actionMenu} />
        {footer}
      </div>
    );
  }

  const rows = pagination?.clientSide
    ? table.getRowModel().rows
    : table.getRowModel().rows;

  // Shared table content
  const tableContent = (
    <Table stickyLayout={stickyLayout}>
      {caption && <TableCaption className="sr-only">{caption}</TableCaption>}
      <TableHeader sticky={stickyLayout}>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id} className="bg-secondary/20">
            {enableExpanding && <TableHead className="w-[3rem]" />}
            {headerGroup.headers.map((headerCell) => (
              <TableHead
                key={headerCell.id}
                className="text-sm font-medium"
                style={{
                  width:
                    headerCell.column.getSize() !== 150
                      ? headerCell.column.getSize()
                      : undefined,
                }}
              >
                {headerCell.isPlaceholder
                  ? null
                  : flexRender(
                      headerCell.column.columnDef.header,
                      headerCell.getContext(),
                    )}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {isInitialLoading ? (
          // Show skeleton rows during initial loading (matching DataTableSkeleton style)
          Array.from({ length: skeletonRows }).map((_, rowIndex) => (
            <TableRow key={`skeleton-${rowIndex}`}>
              {enableExpanding && <TableCell className="w-[3rem]" />}
              {columns.map((col, colIndex) => {
                const isFirstColumn = colIndex === 0;
                const isActionColumn =
                  (col.meta as { isAction?: boolean } | undefined)?.isAction ===
                  true;

                const cellContent = isActionColumn ? (
                  <HStack justify="end">
                    <Skeleton className="h-8 w-8 rounded-md" />
                  </HStack>
                ) : isFirstColumn ? (
                  <HStack gap={3}>
                    <Skeleton className="size-8 shrink-0 rounded-md" />
                    <Stack gap={1} className="flex-1">
                      <Skeleton className="h-3.5 w-full max-w-48" />
                      <Skeleton className="h-3 w-2/3 max-w-24" />
                    </Stack>
                  </HStack>
                ) : (
                  <Skeleton className="h-3.5 w-full max-w-[80%]" />
                );

                return <TableCell key={colIndex}>{cellContent}</TableCell>;
              })}
            </TableRow>
          ))
        ) : rows.length === 0 && hasActiveFilters ? (
          <TableRow>
            <TableCell
              colSpan={columns.length + (enableExpanding ? 1 : 0)}
              className="py-16 text-center"
            >
              <VStack align="center" className="text-center">
                <h4 className="text-foreground mb-1 text-base font-semibold">
                  {t('search.noResults')}
                </h4>
                <p className="text-muted-foreground text-sm">
                  {t('search.tryAdjusting')}
                </p>
              </VStack>
            </TableCell>
          </TableRow>
        ) : rows.length === 0 ? null : (
          rows.map((row, index) => {
            const isExpanded = row.getIsExpanded();
            const rowClassNameValue =
              typeof rowClassName === 'function'
                ? rowClassName(row)
                : rowClassName;
            const isNewRow = animatingRows.has(row.id);

            return (
              <Fragment key={row.id}>
                <TableRow
                  className={cn(
                    'group',
                    index === rows.length - 1 ? 'border-b-0' : '',
                    clickableRows || onRowClick ? 'cursor-pointer' : '',
                    isNewRow && 'animate-row-enter',
                    rowClassNameValue,
                  )}
                  data-state={row.getIsSelected() ? 'selected' : undefined}
                  onClick={() => {
                    if (enableExpanding) {
                      row.toggleExpanded();
                    }
                    onRowClick?.(row);
                  }}
                >
                  {enableExpanding && (
                    <TableCell className="w-[3rem]">
                      <ChevronRight
                        className={cn(
                          'size-4 text-muted-foreground transition-transform duration-200',
                          isExpanded && 'rotate-90',
                        )}
                      />
                    </TableCell>
                  )}
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
                {enableExpanding && isExpanded && renderExpandedRow && (
                  <TableRow className="border-0 hover:bg-transparent">
                    <TableCell colSpan={columns.length + 1} className="p-0">
                      <div className="animate-in fade-in-0 slide-in-from-top-1 grid duration-150">
                        <div className="bg-muted/20 px-4 pb-2">
                          {renderExpandedRow(row)}
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })
        )}
      </TableBody>
    </Table>
  );

  // Shared pagination content
  const paginationContent = pagination && (
    <DataTablePagination
      currentPage={
        pagination.clientSide ? internalPagination.pageIndex + 1 : currentPage
      }
      total={pagination.total ?? data.length}
      pageSize={pagination.pageSize}
      totalPages={pagination.totalPages}
      hasNextPage={pagination.hasNextPage}
      hasPreviousPage={pagination.hasPreviousPage}
      onPageChange={(page) => {
        if (pagination.clientSide) {
          setInternalPagination((prev) => ({
            ...prev,
            pageIndex: page - 1,
          }));
        }
        pagination.onPageChange?.(page);
      }}
      isLoading={pagination.isLoading}
      showPageSizeSelector={pagination.showPageSizeSelector}
      pageSizeOptions={pagination.pageSizeOptions}
      onPageSizeChange={(size) => {
        if (pagination.clientSide) {
          setInternalPagination((prev) => ({
            ...prev,
            pageSize: size,
            pageIndex: 0,
          }));
        }
        pagination.onPageSizeChange?.(size);
      }}
      className={pagination.className}
    />
  );

  // Infinite scroll content - renders inside table container
  // Shows sentinel element for auto-loading, manual button, or end-of-list indicator
  const infiniteScrollContent = infiniteScroll && data.length > 0 && (
    <div className="border-border border-t">
      {infiniteScroll.hasMore ? (
        <>
          {/* Sentinel element for IntersectionObserver (auto-loading) */}
          {infiniteScroll.autoLoad !== false && (
            <div ref={sentinelRef} className="h-px w-full" aria-hidden="true" />
          )}

          {/* Loading indicator or manual button */}
          <div className="flex justify-center py-3">
            {infiniteScroll.isLoadingMore ? (
              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <Spinner size="sm" label={t('pagination.loading')} />
                <span>{t('pagination.loading')}</span>
              </div>
            ) : infiniteScroll.autoLoad === false ? (
              <Button
                variant="ghost"
                onClick={infiniteScroll.onLoadMore}
                aria-label={t('pagination.loadMore')}
              >
                {t('pagination.loadMore')}
              </Button>
            ) : null}
          </div>
        </>
      ) : (
        <output className="text-muted-foreground block py-3 text-center text-xs">
          {t('pagination.noMore')}
        </output>
      )}
    </div>
  );

  // Non-sticky layout: simple stacked layout with gaps
  if (!stickyLayout) {
    return (
      <ErrorBoundaryBase
        organizationId={orgId}
        fallback={({ error, reset }) => (
          <ErrorDisplayCompact
            error={error}
            organizationId={orgId}
            reset={reset}
          />
        )}
      >
        <div className={cn('space-y-4', className)}>
          {headerContent}
          <div className="border-border overflow-hidden rounded-xl border">
            {tableContent}
            {infiniteScrollContent}
          </div>
          {paginationContent}
          {footer}
        </div>
      </ErrorBoundaryBase>
    );
  }

  // Sticky layout: flex layout with fixed header/footer and scrollable table
  return (
    <ErrorBoundaryBase
      organizationId={orgId}
      fallback={({ error, reset }) => (
        <ErrorDisplayCompact
          error={error}
          organizationId={orgId}
          reset={reset}
        />
      )}
    >
      <div className={cn('flex flex-col flex-1 min-h-0', className)}>
        {headerContent && (
          <div className="flex-shrink-0 pb-4">{headerContent}</div>
        )}
        <div
          ref={scrollContainerRef}
          className="border-border min-h-0 overflow-auto rounded-xl border"
        >
          {tableContent}
          {infiniteScrollContent}
        </div>
        {paginationContent && (
          <div className="flex-shrink-0 pt-6">{paginationContent}</div>
        )}
        {footer}
      </div>
    </ErrorBoundaryBase>
  );
}

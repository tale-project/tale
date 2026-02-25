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
  useMemo,
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
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
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

interface ColumnMeta {
  isAction?: boolean;
  hasAvatar?: boolean;
  skeleton?: {
    type?: 'text' | 'badge' | 'id-copy' | 'avatar-text' | 'action' | 'switch';
  };
  align?: 'left' | 'center' | 'right';
}

export interface DataTableProps<TData, TValue = unknown> {
  /** Column definitions */
  columns: ColumnDef<TData, TValue>[];
  /** Data to display */
  data: TData[];
  /** Accessible table caption for screen readers */
  caption?: string;
  /** Empty state configuration */
  emptyState?: DataTableEmptyStateProps;
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
  /**
   * Approximate row count for the skeleton display.
   * - `undefined`: count still loading (shows minimal skeleton placeholder)
   * - `0`: no data expected (shows empty state immediately)
   * - `> 0`: shows this many skeleton rows while data loads
   */
  approxRowCount?: number;
  /** Whether the table data is loading externally (shows skeleton rows) */
  isLoading?: boolean;
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
  /** Called when the pointer enters a row; use with usePreloadRoute for programmatic preloading */
  onRowMouseEnter?: (row: Row<TData>) => void;

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
 * - Empty states (initial and filtered) rendered inside the table
 * - Loading skeletons via approxRowCount
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
  onRowMouseEnter,
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
  approxRowCount,
  isLoading = false,
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
      pageSize: pagination?.pageSize ?? 20,
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

  // Whether any filters are actively applied (memoized for stable dependency)
  const hasActiveFilters = useMemo(
    () =>
      !!(search?.value && search.value.trim().length > 0) ||
      !!(filters && filters.some((f) => f.selectedValues.length > 0)) ||
      !!dateRange?.from ||
      !!dateRange?.to,
    [search?.value, filters, dateRange?.from, dateRange?.to],
  );

  // Combined loading signal: data rows are still in flight
  const isDataLoading = infiniteScroll?.isInitialLoading || isLoading;

  // ---------------------------------------------------------------------------
  // Table body state machine
  //
  // Derives what the table body should render from three independent signals:
  //   1. approxRowCount — drives skeleton vs empty decision
  //   2. isDataLoading  — whether the data query is still in flight
  //   3. data.length    — whether actual rows have arrived
  //
  // States:
  //   'loading'        — count unknown, show minimal skeleton (3 rows)
  //   'skeleton'       — count known > 0, show N skeleton rows
  //   'empty'          — no data, emptyState provided, no active filters
  //   'filtered-empty' — no data, active filters present
  //   'idle-empty'     — no data, no emptyState, no filters
  //   'data'           — rows available
  // ---------------------------------------------------------------------------
  const tableBodyState = useMemo(() => {
    const isRowCountLoading = approxRowCount === undefined;

    if (!isDataLoading) {
      // Has data
      if (data.length > 0) return 'data';
      // Has filters
      if (hasActiveFilters) return 'filtered-empty';
      // Has empty state
      if (emptyState) return 'empty';
      // Has neither data, filters nor empty state
      return 'idle-empty';
    }

    if (!isRowCountLoading) {
      // Can have data
      if (approxRowCount > 0) return 'skeleton';
      // Has empty state
      if (emptyState) return 'empty';
      // Has neither data nor empty state
      return 'idle-empty';
    }

    // Count and data is loading — show minimal skeleton placeholder
    return 'loading';
  }, [
    approxRowCount,
    isDataLoading,
    data.length,
    emptyState,
    hasActiveFilters,
  ]);

  // Number of skeleton rows to render based on current state
  const skeletonRowCount =
    tableBodyState === 'loading'
      ? 3
      : tableBodyState === 'skeleton'
        ? (approxRowCount ?? 0)
        : 0;

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

  const colSpan = columns.length + (enableExpanding ? 1 : 0);

  const rows = table.getRowModel().rows;

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
        {tableBodyState === 'loading' || tableBodyState === 'skeleton' ? (
          // Skeleton rows — count-loading uses 3 placeholder rows,
          // skeleton uses the actual approxRowCount
          Array.from({ length: skeletonRowCount }).map((_, rowIndex) => (
            <TableRow key={`skeleton-${rowIndex}`}>
              {enableExpanding && <TableCell className="w-[3rem]" />}
              {columns.map((col, colIndex) => {
                // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ColumnDef.meta is typed as unknown by TanStack Table
                const meta = col.meta as ColumnMeta | undefined;
                const isFirstColumn = colIndex === 0;
                const isActionCol = meta?.isAction === true;
                const skeletonType = meta?.skeleton?.type;
                const hasAvatar = meta?.hasAvatar;
                const align = meta?.align;

                let cellContent: ReactNode;

                if (isActionCol || skeletonType === 'action') {
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
                } else if (
                  hasAvatar === true ||
                  skeletonType === 'avatar-text' ||
                  (isFirstColumn && hasAvatar !== false)
                ) {
                  cellContent = (
                    <HStack gap={3}>
                      <Skeleton className="size-8 shrink-0 rounded-md" />
                      <Stack gap={1} className="flex-1">
                        <Skeleton className="h-3.5 w-full max-w-48" />
                        <Skeleton className="h-3 w-2/3 max-w-24" />
                      </Stack>
                    </HStack>
                  );
                } else if (align === 'right') {
                  cellContent = (
                    <div className="flex justify-end">
                      <Skeleton className="h-3.5 w-20" />
                    </div>
                  );
                } else if (align === 'center') {
                  cellContent = (
                    <div className="flex justify-center">
                      <Skeleton className="h-3.5 w-20" />
                    </div>
                  );
                } else {
                  cellContent = (
                    <Skeleton className="h-3.5 w-full max-w-[80%]" />
                  );
                }

                return <TableCell key={colIndex}>{cellContent}</TableCell>;
              })}
            </TableRow>
          ))
        ) : tableBodyState === 'empty' ? (
          // Initial empty state — no data and no filters active
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={colSpan} className="p-4">
              <DataTableEmptyState
                icon={emptyState?.icon}
                title={emptyState?.title ?? ''}
                description={emptyState?.description}
              />
            </TableCell>
          </TableRow>
        ) : tableBodyState === 'filtered-empty' ? (
          // Filtered empty state — filters applied but no matching rows
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={colSpan} className="p-4">
              <DataTableEmptyState
                title={t('search.noResults')}
                description={t('search.tryAdjusting')}
              />
            </TableCell>
          </TableRow>
        ) : tableBodyState === 'idle-empty' ? null : (
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
                  onMouseEnter={() => onRowMouseEnter?.(row)}
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
                <Text as="span">{t('pagination.loading')}</Text>
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

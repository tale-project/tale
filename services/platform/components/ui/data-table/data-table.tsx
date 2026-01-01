'use client';

import { Fragment, useState, type ReactNode } from 'react';
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
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils/cn';
import { ChevronRight } from 'lucide-react';
import { useT } from '@/lib/i18n';
import {
  DataTableEmptyState,
  DataTableFilteredEmptyState,
  type DataTableEmptyStateProps,
} from './data-table-empty-state';
import {
  DataTablePagination,
  type DataTablePaginationProps,
} from './data-table-pagination';
import { DataTableSkeleton } from './data-table-skeleton';
import { DataTableFilters, type FilterConfig } from './data-table-filters';
import type { DataTableSearchConfig, DataTableSortingConfig } from './use-data-table';
import type { DateRange } from 'react-day-picker';

export interface DataTableProps<TData> {
  /** Column definitions */
  columns: ColumnDef<TData, unknown>[];
  /** Data to display */
  data: TData[];
  /** Accessible table caption for screen readers */
  caption?: string;
  /** Whether the table is loading */
  isLoading?: boolean;
  /** Empty state configuration (actionMenu is automatically provided) */
  emptyState?: Omit<DataTableEmptyStateProps, 'actionMenu'>;
  /** Pagination configuration */
  pagination?: Omit<DataTablePaginationProps, 'currentPage'> & {
    /** Whether to use client-side pagination */
    clientSide?: boolean;
  };
  /** Current page (1-based, for server-side pagination) */
  currentPage?: number;
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
export function DataTable<TData>({
  columns,
  data,
  caption,
  isLoading = false,
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
}: DataTableProps<TData>) {
  const { t } = useT('common');

  // Extract sorting config - presence of sortingConfig enables sorting
  const enableSorting = !!sortingConfig;
  const initialSorting = sortingConfig?.initialSorting ?? [];
  const onSortingChange = sortingConfig?.onSortingChange;

  // Determine if we should render header
  const hasHeader = search || (filters && filters.length > 0) || dateRange || actionMenu;

  // Build the header content
  const headerContent = hasHeader ? (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
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

  // Internal state for uncontrolled modes
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

  // Show skeleton while loading
  if (isLoading) {
    // For non-sticky layout, use the skeleton's built-in layout
    if (!stickyLayout) {
      return (
        <div className={cn('space-y-4', className)}>
          {headerContent}
          <DataTableSkeleton
            rows={pagination?.pageSize ?? 5}
            columns={columns.map((col) => ({
              header: typeof col.header === 'string' ? col.header : undefined,
            }))}
            showPagination={!!pagination}
          />
          {footer}
        </div>
      );
    }

    // For sticky layout, use flex structure with real pagination
    return (
      <div className={cn('flex flex-col flex-1 min-h-0', className)}>
        {headerContent && (
          <div className="flex-shrink-0 pb-4">{headerContent}</div>
        )}
        <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-border">
          <DataTableSkeleton
            rows={pagination?.pageSize ?? 5}
            columns={columns.map((col) => ({
              header: typeof col.header === 'string' ? col.header : undefined,
            }))}
            stickyLayout
          />
        </div>
        {pagination && (
          <div className="flex-shrink-0 pt-6">
            <DataTablePagination
              currentPage={currentPage}
              total={0}
              pageSize={pagination.pageSize}
              totalPages={1}
              isLoading={true}
            />
          </div>
        )}
        {footer}
      </div>
    );
  }

  // Check if any filters are actively applied
  const hasActiveFilters =
    (search?.value && search.value.trim().length > 0) ||
    (filters && filters.some((f) => f.selectedValues.length > 0)) ||
    (dateRange?.from || dateRange?.to);

  // Show empty state when no data (but not while loading to prevent flashing)
  if (data.length === 0 && emptyState && !isLoading) {
    return (
      <div
        className={cn(
          stickyLayout ? 'flex flex-col flex-1 min-h-0' : 'space-y-4',
          className,
        )}
      >
        {hasActiveFilters ? (
          <DataTableFilteredEmptyState
            title={t('search.noResults')}
            description={t('search.tryAdjusting')}
            headerContent={headerContent}
            stickyLayout={stickyLayout}
          />
        ) : (
          <DataTableEmptyState
            {...emptyState}
            actionMenu={actionMenu}
          />
        )}
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
                className="font-medium text-sm"
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
        {rows.length === 0 && hasActiveFilters ? (
          <TableRow>
            <TableCell
              colSpan={columns.length + (enableExpanding ? 1 : 0)}
              className="text-center py-10 text-muted-foreground"
            >
              {t('search.noResults')}
            </TableCell>
          </TableRow>
        ) : rows.length === 0 ? null : (
          rows.map((row, index) => {
            const isExpanded = row.getIsExpanded();
            const rowClassNameValue =
              typeof rowClassName === 'function'
                ? rowClassName(row)
                : rowClassName;

            return (
              <Fragment key={row.id}>
                <TableRow
                  className={cn(
                    'group',
                    index === rows.length - 1 ? 'border-b-0' : '',
                    clickableRows || onRowClick ? 'cursor-pointer' : '',
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
                  <TableRow className="hover:bg-transparent border-0">
                    <TableCell colSpan={columns.length + 1} className="p-0">
                      <div className="grid animate-in fade-in-0 slide-in-from-top-1 duration-150">
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

  // Non-sticky layout: simple stacked layout with gaps
  if (!stickyLayout) {
    return (
      <div className={cn('space-y-4', className)}>
        {headerContent}
        {tableContent}
        {paginationContent}
        {footer}
      </div>
    );
  }

  // Sticky layout: flex layout with fixed header/footer and scrollable table
  return (
    <div className={cn('flex flex-col flex-1 min-h-0', className)}>
      {headerContent && (
        <div className="flex-shrink-0 pb-4">{headerContent}</div>
      )}
      <div className="min-h-0 overflow-auto rounded-xl border border-border">
        {tableContent}
      </div>
      {paginationContent && (
        <div className="flex-shrink-0 pt-6">{paginationContent}</div>
      )}
      {footer}
    </div>
  );
}

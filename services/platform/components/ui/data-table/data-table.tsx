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
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils/cn';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  DataTableEmptyState,
  type DataTableEmptyStateProps,
} from './data-table-empty-state';
import {
  DataTablePagination,
  type DataTablePaginationProps,
} from './data-table-pagination';
import { DataTableSkeleton } from './data-table-skeleton';

export interface DataTableProps<TData> {
  /** Column definitions */
  columns: ColumnDef<TData, unknown>[];
  /** Data to display */
  data: TData[];
  /** Whether the table is loading */
  isLoading?: boolean;
  /** Empty state configuration */
  emptyState?: DataTableEmptyStateProps;
  /** Pagination configuration */
  pagination?: Omit<DataTablePaginationProps, 'currentPage'> & {
    /** Whether to use client-side pagination */
    clientSide?: boolean;
  };
  /** Current page (1-based, for server-side pagination) */
  currentPage?: number;
  /** Enable sorting */
  enableSorting?: boolean;
  /** Initial sorting state */
  initialSorting?: SortingState;
  /** Callback when sorting changes */
  onSortingChange?: OnChangeFn<SortingState>;
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
  /** Header content (filters, actions, etc.) */
  header?: ReactNode;
  /** Footer content */
  footer?: ReactNode;
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
  isLoading = false,
  emptyState,
  pagination,
  currentPage = 1,
  enableSorting = false,
  initialSorting = [],
  onSortingChange,
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
  header,
  footer,
}: DataTableProps<TData>) {
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
    return (
      <div className={cn('space-y-4', className)}>
        {header}
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

  // Show empty state when no data
  if (data.length === 0 && emptyState) {
    return (
      <div className={cn('space-y-4', className)}>
        {header}
        <DataTableEmptyState {...emptyState} />
        {footer}
      </div>
    );
  }

  const rows = pagination?.clientSide
    ? table.getRowModel().rows
    : table.getRowModel().rows;

  return (
    <div className={cn('space-y-4', className)}>
      {header}

      <Table>
        <TableHeader>
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
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length + (enableExpanding ? 1 : 0)}
                className="text-center py-10 text-muted-foreground"
              >
                No results found
              </TableCell>
            </TableRow>
          ) : (
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
                        {isExpanded ? (
                          <ChevronDown className="size-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="size-4 text-muted-foreground" />
                        )}
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
                    <TableRow>
                      <TableCell
                        colSpan={columns.length + 1}
                        className="bg-muted/20 pt-0 px-4"
                      >
                        {renderExpandedRow(row)}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })
          )}
        </TableBody>
      </Table>

      {pagination && (
        <DataTablePagination
          currentPage={
            pagination.clientSide
              ? internalPagination.pageIndex + 1
              : currentPage
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
      )}

      {footer}
    </div>
  );
}

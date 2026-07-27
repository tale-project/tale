'use client';

import { Button } from '@tale/ui/button';
import { HStack, Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Spinner } from '@tale/ui/spinner';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@tale/ui/table';
import { Text } from '@tale/ui/text';
import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
  type ExpandedState,
  type RowSelectionState,
  type OnChangeFn,
} from '@tanstack/react-table';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import {
  Fragment,
  useState,
  useMemo,
  useRef,
  useEffect,
  useCallback,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { DateRange } from 'react-day-picker';

import { ErrorBoundaryBase } from '@/app/components/error-boundaries/core/error-boundary-base';
import { ErrorDisplayCompact } from '@/app/components/error-boundaries/displays/error-display-compact';
import {
  ACTIONS_COLUMN_SIZE,
  SELECT_COLUMN_SIZE,
} from '@/app/components/ui/data-table/column-builders';
import type { DatePreset } from '@/app/components/ui/forms/date-range-picker';
import { useInfiniteScroll } from '@/app/hooks/use-infinite-scroll';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { chainVerticalWheelToScrollParent } from '@/lib/utils/scroll-wheel-chain';

import {
  DataTableActionMenu,
  type DataTableActionMenuItem,
} from './data-table-action-menu';
import {
  DataTableEmptyState,
  type DataTableEmptyStateProps,
} from './data-table-empty-state';
import {
  DataTableFilters,
  isFilterActive,
  type FilterConfig,
} from './data-table-filters';
import {
  DataTablePagination,
  type DataTablePaginationProps,
} from './data-table-pagination';
import {
  entityLabelForms,
  type DataTableSearchConfig,
  type DataTableSortingConfig,
  type EntityLabel,
} from './data-table-types';

/** Skeleton rows rendered when the row count is unknown (consistent default). */
const DEFAULT_SKELETON_ROWS = 6;
/** Upper bound so a large known count doesn't paint hundreds of skeleton rows. */
const MAX_SKELETON_ROWS = 12;

interface ColumnMeta {
  isAction?: boolean;
  hasAvatar?: boolean;
  skeleton?: {
    type?:
      | 'text'
      | 'two-line'
      | 'badge'
      | 'id-copy'
      | 'avatar-text'
      | 'icon-text'
      | 'action'
      | 'checkbox'
      | 'switch';
  };
  align?: 'left' | 'center' | 'right';
  /**
   * Opt this column in as the table's flex column: it alone absorbs ALL the
   * container slack while every sibling stays at its exact declared px. Use
   * when one long prose column (e.g. a description) should soak up the space.
   * Without it, content columns share the container proportionally to their
   * declared `size` (used as ratios). Its declared `size` still counts toward
   * the table's min-width floor, so keep it at the column's readable minimum.
   */
  flex?: boolean;
  /**
   * Extra classes applied to this column's header AND body cells (and the
   * matching skeleton cell). Use responsive utilities like `hidden md:table-cell`
   * to drop low-priority columns on small screens.
   */
  className?: string;
}

/**
 * The single primary "create" affordance for a collection. Rendered in the
 * header at a fixed size + placement when the table has rows or toolbar
 * chrome; when the table is initially empty with no search/filters, the same
 * control is synthesized into the empty-state CTA so the create button sits
 * with the empty copy. Prefer this over the raw `actionMenu` slot.
 */
export interface DataTableAddAction {
  /** Button label, e.g. "New customer". */
  label: string;
  /** Optional leading icon. */
  icon?: LucideIcon;
  /** Click handler (e.g. open a create dialog). Required for the empty-state CTA. */
  onClick?: () => void;
  /** Navigate instead of handling a click (renders a link). */
  href?: string;
  /** Render a dropdown of create options instead of a single button. */
  menuItems?: DataTableActionMenuItem[];
  /** Disable the action (e.g. lacking write permission). */
  disabled?: boolean;
  /** Button variant (default `primary`). */
  variant?: 'primary' | 'secondary' | 'ghost';
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
    /** Entity noun. Enables the "Showing all X {entity}" footer — pass `{ one, other }` so a single-row table reads correctly too. */
    entityLabel?: EntityLabel;
    /** Unfiltered total count. When different from the shown count, shows "Showing X of Y {entity}". */
    totalCount?: number;
    /**
     * Entities the visible rows represent, when a row can aggregate several —
     * a folder row stands in for its members, so the footer must count the
     * entities behind it, not the row itself (#2348). Defaults to data.length.
     */
    displayedCount?: number;
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
  /**
   * Enable row selection. Pass `true` to allow selecting any row, or a
   * predicate `(row) => boolean` to gate selectability per-row (folder
   * aggregates, read-only rows, etc.). Mirrors TanStack Table's own
   * `enableRowSelection` shape so the function form goes straight through.
   */
  enableRowSelection?: boolean | ((row: Row<TData>) => boolean);
  /** Row selection state (controlled) */
  rowSelection?: RowSelectionState;
  /** Callback when row selection changes */
  onRowSelectionChange?: OnChangeFn<RowSelectionState>;
  /** Enable expandable rows */
  enableExpanding?: boolean;
  /** Render function for expanded row content */
  renderExpandedRow?: (row: Row<TData>) => ReactNode;
  /**
   * Row ids to expand automatically ONCE when they first appear (e.g. a
   * freshly created row whose expanded panel is the next step). Each id
   * auto-expands a single time — a user collapse is never fought.
   */
  autoExpandRowIds?: string[];
  /** Get row ID for selection/expansion */
  getRowId?: (row: TData) => string;
  /** Additional class name for the table container */
  className?: string;
  /** Additional class name for table rows */
  rowClassName?: string | ((row: Row<TData>) => string);
  /** Callback when a row is clicked */
  onRowClick?: (row: Row<TData>) => void;
  /**
   * Per-row guard for `onRowClick`. When provided, only rows for which it
   * returns `true` are clickable (cursor + click handler); the rest render as
   * plain rows. Defaults to every row being clickable when `onRowClick` is set.
   */
  isRowClickable?: (row: Row<TData>) => boolean;
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
  /**
   * The primary create affordance. DataTable renders it in the header at a
   * fixed size + placement and reuses it as the empty-state CTA. Preferred over
   * the raw `actionMenu` slot, which exists only for bespoke header content.
   */
  addAction?: DataTableAddAction;
  /**
   * Escape hatch for bespoke header content. For the standard "Add X" button,
   * use `addAction` instead so size/placement stay consistent across lists.
   */
  actionMenu?: ReactNode;
  /**
   * Extra content rendered inside the filter bar (left side, alongside the
   * search input) — e.g. an inline toggle like "show archived". Keeps the
   * `actionMenu` slot reserved for the primary right-aligned action so the
   * header matches the other list pages.
   */
  filtersContent?: ReactNode;
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
  autoExpandRowIds,
  getRowId,
  className,
  rowClassName,
  onRowClick,
  isRowClickable,
  onRowMouseEnter,
  clickableRows = false,
  // Header configuration props
  search,
  filters,
  dateRange,
  isFiltersLoading = false,
  onClearFilters,
  addAction,
  actionMenu,
  filtersContent,
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
  const [internalSorting, setInternalSorting] = useState(initialSorting);
  const [internalRowSelection, setInternalRowSelection] =
    useState<RowSelectionState>({});
  const [expanded, setExpanded] = useState<ExpandedState>({});
  // One-shot auto-expansion: expand each listed id the first time it shows
  // up, then leave the row alone (so a manual collapse sticks).
  const autoExpandedRef = useRef(new Set<string>());
  useEffect(() => {
    if (!enableExpanding || !autoExpandRowIds || autoExpandRowIds.length === 0)
      return;
    const fresh = autoExpandRowIds.filter(
      (id) => !autoExpandedRef.current.has(id),
    );
    if (fresh.length === 0) return;
    for (const id of fresh) autoExpandedRef.current.add(id);
    setExpanded((prev) =>
      prev === true
        ? prev
        : { ...prev, ...Object.fromEntries(fresh.map((id) => [id, true])) },
    );
  }, [enableExpanding, autoExpandRowIds]);
  const [internalPagination, setInternalPagination] = useState({
    pageIndex: currentPage - 1,
    pageSize: pagination?.pageSize ?? 20,
  });

  // Ref to the scroll container for sticky layout (needed for IntersectionObserver root)
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // Non-sticky layout: horizontal scrollport that must chain vertical wheel to
  // the page scroller (see chainVerticalWheelToScrollParent).
  const horizontalScrollRef = useRef<HTMLDivElement>(null);

  // Track previous row count for animation on load more
  const prevRowCountRef = useRef(0);
  const [animatingRows, setAnimatingRows] = useState(new Set<string>());

  // Stable noop callback for when infiniteScroll is not provided
  const noop = useCallback(() => {}, []);

  useEffect(() => {
    if (stickyLayout) return undefined;
    const el = horizontalScrollRef.current;
    if (!el) return undefined;
    const onWheel = (event: WheelEvent) => {
      chainVerticalWheelToScrollParent(el, event);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [stickyLayout]);

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
    return undefined;
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
      // Forward the consumer's predicate (or `true`) straight to TanStack so
      // per-row gating works without an intermediate translation.
      enableRowSelection,
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
      !!filters?.some(isFilterActive) ||
      !!dateRange?.from ||
      !!dateRange?.to,
    [search?.value, filters, dateRange?.from, dateRange?.to],
  );

  // Combined loading signal: data rows are still in flight
  const isDataLoading = infiniteScroll?.isInitialLoading || isLoading;

  // Disable the search box when the dataset is genuinely empty — no rows AND no
  // active filters/search, so there is nothing to search. A filtered-empty
  // result keeps it enabled so the user can still adjust or clear the query.
  const searchDisabled =
    !isDataLoading && data.length === 0 && !hasActiveFilters;

  // A widening filter (see `FilterConfig.widensResultSet`) can reveal rows the
  // default query hides — e.g. "show archived" on a list whose every row is
  // archived. Its presence keeps the filter button usable on an empty
  // unfiltered table, where a purely narrowing filter set stays disabled.
  const filtersDisabled =
    searchDisabled && !filters?.some((f) => f.widensResultSet);

  // Floor the table at the sum of the columns' declared widths (+ the expand
  // column when present) so a narrow viewport scrolls horizontally instead of
  // squashing columns below their sizes. `getTotalSize()` is the real content
  // width; the previous `columns.length * 8rem` heuristic under-counted tables
  // with wide columns (e.g. a 240px Action column), so the auto/flex columns
  // (Timestamp here) collapsed before the scrollbar appeared. On a wide
  // viewport `max(100%, …)` still lets the table fill the container.
  const tableMinWidth = `${table.getTotalSize() + (enableExpanding ? 48 : 0)}px`;

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
      // A filter narrowed the loaded rows to zero, but infinite-scroll is still
      // draining backend pages — show loading, not "no results", so a match on
      // an un-loaded page isn't prematurely reported as empty (#2054).
      if (hasActiveFilters && infiniteScroll?.hasMore) return 'skeleton';
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
    infiniteScroll?.hasMore,
  ]);

  const isSkeleton =
    tableBodyState === 'loading' || tableBodyState === 'skeleton';

  // Number of skeleton rows to render based on current state. When the count
  // is unknown we render a consistent default block; when it's known we render
  // that many, capped so a huge table doesn't paint hundreds of skeleton rows.
  const skeletonRowCount =
    tableBodyState === 'loading'
      ? DEFAULT_SKELETON_ROWS
      : tableBodyState === 'skeleton'
        ? Math.min(approxRowCount ?? 0, MAX_SKELETON_ROWS)
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

  // The primary "Add X" affordance. The explicit `actionMenu` slot wins (bespoke
  // header content); otherwise `addAction` renders at the default (h-9) size and
  // the standard right-aligned placement so every list's add button looks the
  // same — and lines up with the h-9 search/filter controls in the same toolbar.
  const addActionControl = addAction ? (
    <DataTableActionMenu
      label={addAction.label}
      icon={addAction.icon}
      onClick={addAction.onClick}
      href={addAction.href}
      menuItems={addAction.menuItems}
      disabled={addAction.disabled}
      variant={addAction.variant ?? 'primary'}
    />
  ) : null;

  const hasToolbarChrome =
    !!search ||
    !!(filters && filters.length > 0) ||
    !!dateRange ||
    !!filtersContent;

  // Initial empty with no search/filters: park `addAction` in the empty-state
  // body and skip a lone toolbar button above an empty grid. Keep it in the
  // header when toolbar chrome already exists, when `actionMenu` owns the
  // slot, or once rows are present.
  const emptyHostsAddAction =
    tableBodyState === 'empty' &&
    !!addActionControl &&
    !actionMenu &&
    !hasToolbarChrome;
  const primaryAction =
    actionMenu ?? (emptyHostsAddAction ? null : addActionControl);

  // Render the toolbar row when there is search/filter chrome — or when the
  // caller passed a primary action with nowhere else to live. A lone primary
  // action on an empty table moves into the empty state (above).
  const hasHeader = hasToolbarChrome || !!primaryAction;

  // Build the header content
  const headerContent = hasHeader ? (
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
      <DataTableFilters
        search={search ? { ...search, disabled: searchDisabled } : undefined}
        filters={filters}
        dateRange={dateRange}
        isLoading={isFiltersLoading}
        // Mirror `searchDisabled` — empty table + no active filters → nothing
        // to filter against — unless a widening filter could reveal rows.
        disabled={filtersDisabled}
        onClearAll={onClearFilters}
      >
        {filtersContent}
      </DataTableFilters>
      {primaryAction}
    </div>
  ) : null;

  const colSpan = columns.length + (enableExpanding ? 1 : 0);

  const rows = table.getRowModel().rows;

  const isUtilityCol = (id: string, isAction?: boolean) =>
    id === 'select' || id === 'actions' || !!isAction;

  // The table renders with `table-layout: fixed`, so the declared column
  // widths control how the container is divided. Utility columns (select
  // checkbox + actions trigger) are pinned to their exact px size so they
  // land at the same x on every table. Content columns share the REMAINING
  // width proportionally to their declared `size` (ratios, not px) — a wide
  // container grows every column instead of handing all the slack to the
  // first one while its siblings stay frozen at their declared px.
  //
  // One content column is left `width: auto` (the explicit `meta.flex` column
  // or, by default, the first content column): under fixed layout the auto
  // column receives the leftover, which is exactly its proportional share
  // when the siblings carry ratio widths — and it absorbs rounding drift so
  // the ratios never overflow the container. When a column opts in via
  // `meta.flex`, the siblings keep their exact declared px instead and the
  // flex column alone soaks the slack (e.g. a prose/description column).
  const visibleLeafColumns = table.getVisibleLeafColumns();
  const explicitFlexColumnId = visibleLeafColumns.find(
    (column) =>
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ColumnDef.meta is typed as unknown by TanStack Table
      (column.columnDef.meta as ColumnMeta | undefined)?.flex,
  )?.id;
  const flexColumnId =
    explicitFlexColumnId ??
    visibleLeafColumns.find(
      (column) =>
        !isUtilityCol(
          column.id,
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ColumnDef.meta is typed as unknown by TanStack Table
          (column.columnDef.meta as ColumnMeta | undefined)?.isAction,
        ),
    )?.id;

  // Exact px a utility column occupies (mirrors `utilityCellBox`). A declared
  // size of 150 is TanStack's default, i.e. "not set" → canonical width.
  const utilityPx = (id: string, size: number | undefined) =>
    size !== undefined && size !== 150
      ? size
      : id === 'actions'
        ? ACTIONS_COLUMN_SIZE
        : SELECT_COLUMN_SIZE;

  // Pinned px (utility columns + the expand column) subtracted from the
  // container before content columns split the remainder, and the ratio
  // denominator for that split.
  let pinnedPx = enableExpanding ? 48 : 0;
  let contentSizeTotal = 0;
  for (const column of visibleLeafColumns) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ColumnDef.meta is typed as unknown by TanStack Table
    const meta = column.columnDef.meta as ColumnMeta | undefined;
    if (isUtilityCol(column.id, meta?.isAction)) {
      pinnedPx += utilityPx(column.id, column.columnDef.size);
    } else {
      contentSizeTotal += column.getSize();
    }
  }

  const cellWidthStyle = (
    id: string,
    size: number | undefined,
    isAction?: boolean,
  ): CSSProperties =>
    isUtilityCol(id, isAction)
      ? // Under `table-fixed` the declared px width *is* the column width, so
        // pin utility columns to their exact size (a `1%` here would collapse
        // them below the checkbox/trigger box). Matches `utilityCellBox`.
        { width: utilityPx(id, size) }
      : id === flexColumnId
        ? // The flex column: `auto`, so it receives the container leftover —
          // its proportional share by construction (plus rounding slack), or
          // ALL the slack when it opted in via `meta.flex`.
          { width: undefined }
        : explicitFlexColumnId !== undefined || contentSizeTotal === 0
          ? // An explicit `meta.flex` column soaks the slack alone; its
            // siblings keep their exact declared px.
            { width: size !== undefined && size !== 150 ? size : undefined }
          : // Proportional share of the width left after the pinned columns,
            // using declared sizes as ratios. At the `minWidth` floor (table
            // width == sum of declared sizes) this resolves to exactly the
            // declared px; wider containers scale every column up.
            {
              width: `calc((100% - ${pinnedPx}px) * ${((size ?? 150) / contentSizeTotal).toFixed(4)})`,
            };
  // Wrap a utility cell's content in a fixed-width box so the column shrinks to
  // exactly its declared size (the select checkbox centered, the row-actions
  // trigger right-aligned) — identical on every table. `p-0` on the cell hands
  // all spacing to this box so padding doesn't widen the pinned column.
  const utilityCellBox = (
    id: string,
    size: number | undefined,
    node: ReactNode,
  ): ReactNode => (
    <div
      style={{ width: utilityPx(id, size) }}
      className={cn(
        'flex h-full items-center',
        id === 'select' ? 'mx-auto justify-center' : 'ml-auto justify-end pr-3',
      )}
    >
      {node}
    </div>
  );

  // Shared table content. Wrapped in Skeletonize (outside <table>) so the
  // placeholder cells below pulse while loading; idle it adds no box.
  const tableContent = (
    <Skeletonize loading={isSkeleton}>
      <Table
        // Always render the bare <table> (no primitive scroll wrapper). Both
        // layout branches below supply their own scroll container with the
        // border placed on an inner `w-fit min-w-full` wrapper, so the rounded
        // border wraps the full table width and scrolls with the content
        // instead of being pinned to the visible viewport.
        stickyLayout
        // `table-fixed w-full`: columns share the available width by their
        // declared `size` (used as ratios) instead of `auto` layout growing
        // each column to fit its widest non-wrapping cell — which let long
        // values balloon the first column and pushed trailing columns off
        // screen. With `min-w-full` + the `max(100%, …)` floor below, a wide
        // container fits exactly (no horizontal scroll) while a narrow one
        // still scrolls at the content floor instead of squashing.
        className="w-full table-fixed"
        // `max(100%, …)` so the table still fills a wide container (preserving
        // the primitive's `min-w-full`) while gaining a content-based floor that
        // forces horizontal scroll on narrow viewports instead of squashing.
        // Initial empty (no headers, no rows) must NOT inherit the column-size
        // floor — otherwise a 7-column table (~1050px default) scrolls
        // horizontally inside a max-w-3xl settings pane with nothing to reveal.
        style={{
          minWidth:
            tableBodyState === 'empty' || tableBodyState === 'idle-empty'
              ? '100%'
              : `max(100%, ${tableMinWidth})`,
        }}
      >
        {caption && <TableCaption className="sr-only">{caption}</TableCaption>}
        {/* Hide column headers on the initial empty state — an empty grid with
            a lone "Quarter folder" header reads as a broken table; the empty
            copy (+ optional create CTA) is the whole surface. */}
        {tableBodyState !== 'empty' && tableBodyState !== 'idle-empty' ? (
          <TableHeader sticky={stickyLayout}>
            {table.getHeaderGroups().map((headerGroup) => (
              // No `bg-muted` here — `TableHeader` paints the fill on the header
              // cells so the wrapper's rounded corners aren't squared off by a
              // full-width row background.
              <TableRow key={headerGroup.id}>
                {enableExpanding && <TableHead className="w-[3rem]" />}
                {headerGroup.headers.map((headerCell) => {
                  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ColumnDef.meta is typed as unknown by TanStack Table
                  const meta = headerCell.column.columnDef.meta as
                    | ColumnMeta
                    | undefined;
                  const id = headerCell.column.id;
                  const size = headerCell.column.getSize();
                  const utility = isUtilityCol(id, meta?.isAction);
                  const content = headerCell.isPlaceholder
                    ? null
                    : flexRender(
                        headerCell.column.columnDef.header,
                        headerCell.getContext(),
                      );
                  return (
                    <TableHead
                      key={headerCell.id}
                      className={cn(
                        'text-sm font-medium',
                        utility && 'p-0',
                        meta?.className,
                      )}
                      style={cellWidthStyle(id, size, meta?.isAction)}
                    >
                      {utility ? utilityCellBox(id, size, content) : content}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
        ) : null}
        <TableBody>
          {tableBodyState === 'loading' || tableBodyState === 'skeleton' ? (
            // Skeleton rows — count-loading uses 3 placeholder rows,
            // skeleton uses the actual approxRowCount.
            // Text-line widths vary per cell (deterministic, so SSR-stable)
            // instead of painting a uniform grid of identical bars; the width
            // lives on a wrapper around the box because a narrower placeholder
            // INSIDE a fullWidth SkeletonBox is ignored by the mask.
            Array.from({ length: skeletonRowCount }).map((_, rowIndex) => (
              // `h-12` mirrors the real data rows below — without it the
              // skeleton collapses to its content height (~32px) and reads as a
              // dense, tight list that doesn't match the roomier loaded table.
              // Must be `h-12`, not `min-h-12`: CSS ignores `min-height` on a
              // table row (`display: table-row`), whereas `height` is treated as
              // a *minimum* there, so taller cells still grow the row past it.
              <TableRow key={`skeleton-${rowIndex}`} className="h-12">
                {enableExpanding && <TableCell className="w-[3rem]" />}
                {columns.map((col, colIndex) => {
                  const textWidth = (salt: number, min: number, span: number) =>
                    `${min + ((rowIndex * 17 + colIndex * 29 + salt * 13) % span)}%`;
                  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ColumnDef.meta is typed as unknown by TanStack Table
                  const meta = col.meta as ColumnMeta | undefined;
                  const isActionCol = meta?.isAction === true;
                  const skeletonType = meta?.skeleton?.type;
                  const hasAvatar = meta?.hasAvatar;
                  const align = meta?.align;

                  let cellContent: ReactNode;

                  if (isActionCol || skeletonType === 'action') {
                    cellContent = (
                      <HStack justify="end">
                        <SkeletonBox>
                          <div className="h-8 w-8 rounded-md" />
                        </SkeletonBox>
                      </HStack>
                    );
                  } else if (skeletonType === 'checkbox') {
                    // Mirrors the real 16px checkbox (`size-4`) — NOT the 32px
                    // `action` button shape. In the pinned 40px select column an
                    // `h-8 w-8` block leaves only ~4px each side and reads as
                    // edge-to-edge; a `size-4` square keeps the ~12px gutter the
                    // loaded checkbox has.
                    cellContent = (
                      <SkeletonBox>
                        <div className="size-4 rounded" />
                      </SkeletonBox>
                    );
                  } else if (skeletonType === 'badge') {
                    cellContent = (
                      <SkeletonBox>
                        <div className="h-5 w-20 rounded-full" />
                      </SkeletonBox>
                    );
                  } else if (skeletonType === 'switch') {
                    cellContent = (
                      <SkeletonBox>
                        <div className="h-[1.15rem] w-8 rounded-full" />
                      </SkeletonBox>
                    );
                  } else if (skeletonType === 'id-copy') {
                    cellContent = (
                      <HStack gap={2}>
                        <div className="min-w-0 flex-1">
                          <div className="max-w-[120px]">
                            <SkeletonBox fullWidth>
                              <div className="h-3.5" />
                            </SkeletonBox>
                          </div>
                        </div>
                        <SkeletonBox>
                          <div className="size-6 shrink-0 rounded-md" />
                        </SkeletonBox>
                      </HStack>
                    );
                  } else if (
                    hasAvatar === true ||
                    skeletonType === 'avatar-text'
                  ) {
                    // Avatar + two text lines — only when a column explicitly
                    // opts in (via `hasAvatar`/`avatar-text`). Previously the
                    // FIRST column defaulted to this shape, which painted a
                    // phantom avatar on every text-first table (API keys, MCP,
                    // workflow executions, …) — the "skeleton doesn't match content" bug.
                    cellContent = (
                      <HStack gap={3}>
                        <SkeletonBox>
                          <div className="size-8 shrink-0 rounded-md" />
                        </SkeletonBox>
                        <Stack gap={1} className="min-w-0 flex-1">
                          <div
                            className="max-w-48"
                            style={{ width: textWidth(1, 62, 31) }}
                          >
                            <SkeletonBox fullWidth>
                              <div className="h-3.5" />
                            </SkeletonBox>
                          </div>
                          <div
                            className="max-w-24"
                            style={{ width: textWidth(2, 38, 25) }}
                          >
                            <SkeletonBox fullWidth>
                              <div className="h-3" />
                            </SkeletonBox>
                          </div>
                        </Stack>
                      </HStack>
                    );
                  } else if (skeletonType === 'icon-text') {
                    cellContent = (
                      <HStack gap={3}>
                        <SkeletonBox>
                          <div className="size-4 shrink-0 rounded" />
                        </SkeletonBox>
                        <div className="min-w-0 flex-1">
                          <div
                            className="max-w-48"
                            style={{ width: textWidth(3, 62, 31) }}
                          >
                            <SkeletonBox fullWidth>
                              <div className="h-3.5" />
                            </SkeletonBox>
                          </div>
                        </div>
                      </HStack>
                    );
                  } else if (skeletonType === 'two-line') {
                    // Primary + secondary line (e.g. email over actor id) so the
                    // skeleton row matches the real two-line cell height.
                    cellContent = (
                      <Stack gap={1} className="min-w-0">
                        <div
                          className="max-w-48"
                          style={{ width: textWidth(4, 62, 31) }}
                        >
                          <SkeletonBox fullWidth>
                            <div className="h-3.5" />
                          </SkeletonBox>
                        </div>
                        <div
                          className="max-w-24"
                          style={{ width: textWidth(5, 38, 25) }}
                        >
                          <SkeletonBox fullWidth>
                            <div className="h-3" />
                          </SkeletonBox>
                        </div>
                      </Stack>
                    );
                  } else if (align === 'right') {
                    cellContent = (
                      <div className="flex justify-end">
                        <SkeletonBox>
                          <div className="h-3.5 w-20" />
                        </SkeletonBox>
                      </div>
                    );
                  } else if (align === 'center') {
                    cellContent = (
                      <div className="flex justify-center">
                        <SkeletonBox>
                          <div className="h-3.5 w-20" />
                        </SkeletonBox>
                      </div>
                    );
                  } else {
                    cellContent = (
                      <div style={{ width: textWidth(6, 52, 38) }}>
                        <SkeletonBox fullWidth>
                          <div className="h-3.5" />
                        </SkeletonBox>
                      </div>
                    );
                  }

                  const id = col.id ?? '';
                  const utility = isUtilityCol(id, isActionCol);
                  return (
                    <TableCell
                      key={colIndex}
                      className={cn(utility && 'p-0', meta?.className)}
                      style={cellWidthStyle(id, col.size, isActionCol)}
                    >
                      {utility
                        ? utilityCellBox(id, col.size, cellContent)
                        : cellContent}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))
          ) : tableBodyState === 'empty' ? (
            // Initial empty state — no data and no filters active. Table
            // minWidth is 100% in this state (no column-size floor), so a
            // plain `w-full` keeps the empty copy inside the bordered frame
            // without a phantom horizontal scrollbar.
            <TableRow data-no-hover>
              <TableCell colSpan={colSpan} className="p-0">
                <div className="w-full p-4">
                  <DataTableEmptyState
                    icon={emptyState?.icon}
                    title={emptyState?.title ?? ''}
                    description={emptyState?.description}
                    headingLevel={emptyState?.headingLevel}
                    action={emptyHostsAddAction ? addActionControl : undefined}
                  />
                </div>
              </TableCell>
            </TableRow>
          ) : tableBodyState === 'filtered-empty' ? (
            // Filtered empty state — filters applied but no matching rows.
            // Headers stay visible and the table may still be wider than the
            // viewport, so stick the empty copy to the left edge of the
            // scrollport (not the full table width).
            <TableRow data-no-hover>
              <TableCell colSpan={colSpan} className="p-0">
                <div className="sticky left-0 w-screen max-w-full p-4">
                  <DataTableEmptyState
                    title={t('search.noResults')}
                    description={t('search.tryAdjusting')}
                    headingLevel={emptyState?.headingLevel}
                  />
                </div>
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
              // A row is click-navigable only when `onRowClick` is set and the
              // optional `isRowClickable` guard admits it — so tables can leave
              // dead rows (e.g. a metrics row with no destination) inert.
              const rowClickable =
                !!onRowClick && (isRowClickable?.(row) ?? true);

              return (
                <Fragment key={row.id}>
                  <TableRow
                    className={cn(
                      'group',
                      // Consistent baseline row height across every table — text-
                      // only rows (e.g. projects) would otherwise sit shorter than
                      // rows with an avatar/icon. `h-12` is a *minimum* for table
                      // rows, so multi-line cells still grow past it.
                      'h-12',
                      index === rows.length - 1 ? 'border-b-0' : '',
                      clickableRows || rowClickable ? 'cursor-pointer' : '',
                      isNewRow && 'animate-row-enter',
                      rowClassNameValue,
                    )}
                    data-state={row.getIsSelected() ? 'selected' : undefined}
                    aria-selected={row.getIsSelected() || undefined}
                    onMouseEnter={() => onRowMouseEnter?.(row)}
                    onClick={() => {
                      // When both expand and onRowClick are armed, the chevron
                      // owns expand (see cell below) and the row body opens the
                      // detail/navigate path — never both from one click.
                      // Expand-only tables still toggle from the row body.
                      if (rowClickable) {
                        onRowClick?.(row);
                      } else if (enableExpanding) {
                        row.toggleExpanded();
                      }
                    }}
                  >
                    {enableExpanding && (
                      <TableCell className="w-[3rem] p-0">
                        <button
                          type="button"
                          aria-expanded={isExpanded}
                          aria-label={
                            isExpanded ? 'Collapse row' : 'Expand row'
                          }
                          className="hover:bg-muted/50 flex h-12 w-12 items-center justify-center rounded-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            row.toggleExpanded();
                          }}
                        >
                          <ChevronRight
                            className={cn(
                              'size-4 text-muted-foreground transition-transform duration-200',
                              isExpanded && 'rotate-90',
                            )}
                            aria-hidden
                          />
                        </button>
                      </TableCell>
                    )}
                    {row.getVisibleCells().map((cell) => {
                      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ColumnDef.meta is typed as unknown by TanStack Table
                      const meta = cell.column.columnDef.meta as
                        | ColumnMeta
                        | undefined;
                      const id = cell.column.id;
                      const size = cell.column.getSize();
                      const utility = isUtilityCol(id, meta?.isAction);
                      const content = flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      );
                      return (
                        <TableCell
                          key={cell.id}
                          className={cn(utility && 'p-0', meta?.className)}
                          style={cellWidthStyle(id, size, meta?.isAction)}
                        >
                          {utility
                            ? utilityCellBox(id, size, content)
                            : content}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                  {enableExpanding && isExpanded && renderExpandedRow && (
                    <TableRow className="border-0" data-no-hover>
                      <TableCell colSpan={columns.length + 1} className="p-0">
                        <div className="animate-in fade-in-0 slide-in-from-top-1 grid duration-150">
                          {/* min-w-0: a grid item's min-width:auto would let
                              unbreakable content (mono transcripts, long ids)
                              inflate the panel past the cell, where the card's
                              overflow-hidden clips it. Constrain and scroll
                              locally instead. */}
                          <div className="bg-muted/20 min-w-0 overflow-x-auto px-4 pb-2">
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
    </Skeletonize>
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
      entityLabel={pagination.entityLabel}
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
      ) : !infiniteScroll.entityLabel ? (
        <output className="text-muted-foreground block px-3 py-3 text-left text-xs">
          {t('pagination.noMore')}
        </output>
      ) : null}
    </div>
  );

  // A row can aggregate several entities (a folder row stands in for its
  // members), so the count shown must be the entities behind the visible rows,
  // not the row count itself (#2348).
  const shownEntityCount = infiniteScroll
    ? (infiniteScroll.displayedCount ?? data.length)
    : 0;
  const entityCountFooter = infiniteScroll &&
    infiniteScroll.entityLabel &&
    data.length > 0 && (
      <output className="bg-background border-border text-muted-foreground sticky bottom-0 z-10 block px-3 py-3 text-left text-xs">
        {infiniteScroll.totalCount !== undefined &&
        infiniteScroll.totalCount !== shownEntityCount
          ? t('pagination.showingFiltered', {
              filtered: shownEntityCount,
              total: infiniteScroll.totalCount,
              ...entityLabelForms(infiniteScroll.entityLabel),
            })
          : t('pagination.showingAll', {
              count: shownEntityCount,
              ...entityLabelForms(infiniteScroll.entityLabel),
            })}
      </output>
    );

  // Non-sticky layout: simple stacked layout with gaps
  if (!stickyLayout) {
    return (
      <ErrorBoundaryBase
        organizationId={orgId}
        fallback={(fallbackProps) => (
          <ErrorDisplayCompact
            error={fallbackProps.error}
            organizationId={orgId}
            reset={fallbackProps.reset}
          />
        )}
      >
        <div className={cn('space-y-4', className)}>
          {headerContent}
          {/* The bordered frame stays at the container's width — its rounded
              border is always fully visible — while the table scrolls inside
              the `overflow-x-auto` scrollport. The borderless `w-fit
              min-w-full` wrapper spans the full table width so full-width
              children (infinite-scroll footer separators) cover overflowing
              content too. `overflow-hidden` on the frame clips the rounded
              corners (safe here: this layout has no sticky header). */}
          <div className="border-border overflow-hidden rounded-lg border">
            <div ref={horizontalScrollRef} className="overflow-x-auto">
              <div className="w-fit min-w-full">
                {tableContent}
                {infiniteScrollContent}
                {entityCountFooter}
              </div>
            </div>
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
      fallback={(fallbackProps) => (
        <ErrorDisplayCompact
          error={fallbackProps.error}
          organizationId={orgId}
          reset={fallbackProps.reset}
        />
      )}
    >
      <div className={cn('flex flex-col flex-1 min-h-0 min-w-0', className)}>
        {headerContent && <div className="shrink-0 pb-4">{headerContent}</div>}
        {/* The bordered frame stays at the container's width — its rounded
            border is always fully visible — while both axes scroll inside
            `scrollContainerRef`. The sticky header/footer keep working because
            they stick to that inner scrollport, not the frame; the frame's
            `overflow-hidden` only clips the rounded corners. The borderless
            `w-fit min-w-full` wrapper spans the full table width so full-width
            children (infinite-scroll footer separators) cover overflowing
            content too. */}
        <div className="border-border flex min-h-0 flex-col overflow-hidden rounded-lg border">
          <div
            ref={scrollContainerRef}
            className="min-h-0 overflow-auto overscroll-contain"
          >
            <div className="w-fit min-w-full">
              {tableContent}
              {infiniteScrollContent}
              {entityCountFooter}
            </div>
          </div>
        </div>
        {paginationContent && (
          <div className="shrink-0 pt-6">{paginationContent}</div>
        )}
        {/* `pt-4` matches the gap the non-sticky layout gets from `space-y-4`.
            `empty:hidden` collapses the wrapper when the footer renders nothing
            (e.g. the bulk-delete bar with no selection) so it adds no phantom
            gap. */}
        {footer && <div className="shrink-0 pt-4 empty:hidden">{footer}</div>}
      </div>
    </ErrorBoundaryBase>
  );
}

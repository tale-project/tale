/**
 * Unified pagination and filtering types for the frontend
 *
 * These types are used by:
 * - useUrlFilters hook for URL state management
 * - useOffsetPaginatedQuery / useCursorPaginatedQuery hooks
 * - Server-side URL parsing utilities
 */

// ============================================================================
// FILTER TYPES
// ============================================================================

/**
 * Supported filter types:
 * - search: Text input with debouncing
 * - multiSelect: Multiple values from a list (comma-separated in URL)
 * - singleSelect: Single value from a list
 * - dateRange: From/to date range
 */
export type FilterType = 'search' | 'multiSelect' | 'singleSelect' | 'dateRange';

/**
 * Option for multiSelect and singleSelect filters
 */
export interface FilterOption {
  value: string;
  /** Translation key for the label (used with useT hook) */
  labelKey: string;
}

/**
 * Base filter definition
 */
export interface BaseFilterDefinition {
  /** Filter type determines parsing and rendering behavior */
  type: FilterType;
  /** URL query param key (defaults to the filter key if not specified) */
  urlKey?: string;
}

/**
 * Search filter with debouncing support
 */
export interface SearchFilterDefinition extends BaseFilterDefinition {
  type: 'search';
  /** Placeholder translation key */
  placeholderKey?: string;
  /** Debounce delay in ms (default: 300) */
  debounceMs?: number;
}

/**
 * Multi-select filter (checkboxes)
 */
export interface MultiSelectFilterDefinition extends BaseFilterDefinition {
  type: 'multiSelect';
  /** Available options */
  options: FilterOption[];
  /** Filter section title translation key */
  titleKey: string;
  /** Show options in a grid layout */
  grid?: boolean;
}

/**
 * Single-select filter (radio or dropdown)
 */
export interface SingleSelectFilterDefinition extends BaseFilterDefinition {
  type: 'singleSelect';
  /** Available options */
  options: FilterOption[];
  /** Filter section title translation key */
  titleKey: string;
  /** Default value when none selected */
  defaultValue?: string;
}

/**
 * Date range filter
 */
export interface DateRangeFilterDefinition extends BaseFilterDefinition {
  type: 'dateRange';
  /** Filter section title translation key */
  titleKey: string;
}

/**
 * Union type for all filter definitions
 */
export type FilterDefinition =
  | SearchFilterDefinition
  | MultiSelectFilterDefinition
  | SingleSelectFilterDefinition
  | DateRangeFilterDefinition;

/**
 * Record of filter definitions keyed by filter name
 */
export type FilterDefinitions = Record<string, FilterDefinition>;

// ============================================================================
// PARSED FILTER VALUES
// ============================================================================

/**
 * Parsed value type based on filter definition type
 */
export type ParsedFilterValue<T extends FilterDefinition> = T extends SearchFilterDefinition
  ? string
  : T extends MultiSelectFilterDefinition
    ? string[]
    : T extends SingleSelectFilterDefinition
      ? string | undefined
      : T extends DateRangeFilterDefinition
        ? { from?: string; to?: string }
        : never;

/**
 * Parsed filter state from URL
 */
export type ParsedFilters<T extends FilterDefinitions> = {
  [K in keyof T]: ParsedFilterValue<T[K]>;
};

// ============================================================================
// SORTING TYPES
// ============================================================================

/**
 * Sorting state compatible with TanStack Table's SortingState
 */
export interface SortingItem {
  /** Column ID to sort by */
  id: string;
  /** Sort direction (true = descending, false = ascending) */
  desc: boolean;
}

/**
 * Array of sorting items (TanStack Table compatible)
 */
export type SortingState = SortingItem[];

// ============================================================================
// PAGINATION TYPES
// ============================================================================

/**
 * Offset-based pagination state (for page numbers)
 */
export interface OffsetPaginationState {
  page: number;
  pageSize: number;
}

/**
 * Cursor-based pagination state (for infinite scroll)
 */
export interface CursorPaginationState {
  cursor: string | null;
  numItems: number;
}

/**
 * Pagination configuration
 */
export interface PaginationConfig {
  /** Default page size */
  defaultPageSize?: number;
  /** Available page size options */
  pageSizeOptions?: number[];
}

// ============================================================================
// HOOK RETURN TYPES
// ============================================================================

/**
 * Return type for useUrlFilters hook
 */
export interface UseUrlFiltersReturn<T extends FilterDefinitions> {
  /** Current filter values parsed from URL */
  filters: ParsedFilters<T>;
  /** Filter definitions for rendering UI */
  definitions: T;
  /** Current pagination state */
  pagination: OffsetPaginationState;
  /** Current sorting state (TanStack Table compatible) */
  sorting: SortingState;
  /** Update a single filter value */
  setFilter: <K extends keyof T>(key: K, value: ParsedFilterValue<T[K]>) => void;
  /** Set current page */
  setPage: (page: number) => void;
  /** Set page size */
  setPageSize: (size: number) => void;
  /** Set sorting state (TanStack Table compatible) */
  setSorting: (sorting: SortingState | ((prev: SortingState) => SortingState)) => void;
  /** Clear all filters and reset pagination */
  clearAll: () => void;
  /** Whether any filters are active */
  hasActiveFilters: boolean;
  /** Whether URL update is pending (from useTransition) */
  isPending: boolean;
}

/**
 * Return type for useOffsetPaginatedQuery hook
 */
export interface UseOffsetPaginatedQueryReturn<TData> {
  /** Query result data */
  data: TData | undefined;
  /** Whether query is loading */
  isLoading: boolean;
  /** Pagination metadata */
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

/**
 * Return type for useCursorPaginatedQuery hook
 */
export interface UseCursorPaginatedQueryReturn<TData> {
  /** Query result data (accumulated pages) */
  data: TData[];
  /** Whether initial load is in progress */
  isLoading: boolean;
  /** Whether more items are being loaded */
  isLoadingMore: boolean;
  /** Whether there are more items to load */
  hasMore: boolean;
  /** Load more items */
  loadMore: () => void;
  /** Reset to initial state */
  reset: () => void;
}

// ============================================================================
// CONSTANTS
// ============================================================================

export const DEFAULT_PAGE_SIZE = 10;
export const DEFAULT_PAGE = 1;
export const DEFAULT_DEBOUNCE_MS = 300;
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

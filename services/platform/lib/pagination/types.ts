/**
 * Pagination and sorting types for the frontend
 *
 * These types are used by:
 * - Data table components for sorting state
 * - useOffsetPaginatedQuery / useCursorPaginatedQuery hooks
 */

// ============================================================================
// SORTING TYPES
// ============================================================================

/**
 * Sorting state compatible with TanStack Table's SortingState
 */
interface SortingItem {
  /** Column ID to sort by */
  id: string;
  /** Sort direction (true = descending, false = ascending) */
  desc: boolean;
}

/**
 * Array of sorting items (TanStack Table compatible)
 */
export type SortingState = SortingItem[];

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

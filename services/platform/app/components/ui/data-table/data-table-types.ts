'use client';

import type { OnChangeFn } from '@tanstack/react-table';

import type { SortingState } from '@/lib/pagination/types';

export interface DataTableSearchConfig {
  /** Current search value */
  value: string;
  /** Callback when search changes */
  onChange: (value: string) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Width class for the search input */
  className?: string;
}

export interface DataTableSortingConfig {
  /** Current sorting state (synced with URL) */
  initialSorting: SortingState;
  /** Callback when sorting changes (updates URL) */
  onSortingChange: OnChangeFn<SortingState>;
}

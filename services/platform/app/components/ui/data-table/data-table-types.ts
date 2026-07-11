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

/**
 * Entity noun for count-aware footer/pagination copy (e.g. "1 project" vs
 * "5 projects"). A bare string is the legacy plural-only shape — kept so
 * callers that haven't migrated yet keep their current (still
 * over-pluralized) output unchanged; pass `{ one, other }` to get the
 * correct noun form for the visible count (#2646).
 */
export type EntityLabel = string | { one: string; other: string };

/** Normalize an `EntityLabel` into the two ICU sub-message slots the shared
 * pagination/footer message keys interpolate (`entityOne`/`entityOther`). */
export function entityLabelForms(label: EntityLabel): {
  entityOne: string;
  entityOther: string;
} {
  return typeof label === 'string'
    ? { entityOne: label, entityOther: label }
    : { entityOne: label.one, entityOther: label.other };
}

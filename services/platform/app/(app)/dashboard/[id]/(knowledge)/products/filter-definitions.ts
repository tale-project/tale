/**
 * Product filter definitions
 *
 * Defines the filters available for the products table.
 * Used by both server-side URL parsing and client-side filter hooks.
 */

import type { FilterDefinitions } from '@/lib/pagination/types';

export const productFilterDefinitions = {
  query: {
    type: 'search' as const,
    urlKey: 'query',
    placeholderKey: 'products.searchPlaceholder',
    debounceMs: 300,
  },
  status: {
    type: 'multiSelect' as const,
    titleKey: 'tables.headers.status',
    options: [
      { value: 'active', labelKey: 'products.status.active' },
      { value: 'inactive', labelKey: 'products.status.inactive' },
      { value: 'draft', labelKey: 'products.status.draft' },
      { value: 'archived', labelKey: 'products.status.archived' },
    ],
  },
} as const satisfies FilterDefinitions;

export type ProductFilters = typeof productFilterDefinitions;

/**
 * Website filter definitions
 *
 * Defines the filters available for the websites table.
 * Used by both server-side URL parsing and client-side filter hooks.
 */

import type { FilterDefinitions } from '@/lib/pagination/types';

export const websiteFilterDefinitions = {
  query: {
    type: 'search' as const,
    urlKey: 'query',
    placeholderKey: 'websites.searchPlaceholder',
    debounceMs: 300,
  },
  status: {
    type: 'multiSelect' as const,
    titleKey: 'tables.headers.status',
    options: [
      { value: 'active', labelKey: 'websites.status.active' },
      { value: 'scanning', labelKey: 'websites.status.scanning' },
      { value: 'error', labelKey: 'websites.status.error' },
    ],
  },
} as const satisfies FilterDefinitions;

export type WebsiteFilters = typeof websiteFilterDefinitions;

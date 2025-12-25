/**
 * Automation filter definitions
 *
 * Defines the filters available for the automations table.
 * Used by both server-side URL parsing and client-side filter hooks.
 */

import type { FilterDefinitions } from '@/lib/pagination/types';

export const automationFilterDefinitions = {
  query: {
    type: 'search' as const,
    urlKey: 'query',
    placeholderKey: 'automations.searchPlaceholder',
    debounceMs: 300,
  },
  status: {
    type: 'multiSelect' as const,
    titleKey: 'tables.headers.status',
    options: [
      { value: 'active', labelKey: 'automations.status.active' },
      { value: 'draft', labelKey: 'automations.status.draft' },
    ],
  },
} as const satisfies FilterDefinitions;

export type AutomationFilters = typeof automationFilterDefinitions;

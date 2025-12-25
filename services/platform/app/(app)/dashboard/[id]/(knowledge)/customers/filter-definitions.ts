/**
 * Customer filter definitions
 *
 * Defines the filters available for the customers table.
 * Used by both server-side URL parsing and client-side filter hooks.
 */

import type { FilterDefinitions } from '@/lib/pagination/types';

export const customerFilterDefinitions = {
  query: {
    type: 'search' as const,
    urlKey: 'query',
    placeholderKey: 'customers.searchPlaceholder',
    debounceMs: 300,
  },
  status: {
    type: 'multiSelect' as const,
    titleKey: 'tables.headers.status',
    options: [
      { value: 'active', labelKey: 'customers.status.active' },
      { value: 'potential', labelKey: 'customers.status.potential' },
      { value: 'churned', labelKey: 'customers.status.churned' },
      { value: 'lost', labelKey: 'customers.status.lost' },
    ],
  },
  source: {
    type: 'multiSelect' as const,
    titleKey: 'tables.headers.source',
    options: [
      { value: 'manual_import', labelKey: 'customers.filter.source.manual' },
      { value: 'file_upload', labelKey: 'customers.filter.source.upload' },
      { value: 'circuly', labelKey: 'customers.filter.source.circuly' },
    ],
  },
  locale: {
    type: 'multiSelect' as const,
    titleKey: 'tables.headers.locale',
    grid: true,
    options: [
      { value: 'en', labelKey: 'locales.en' },
      { value: 'es', labelKey: 'locales.es' },
      { value: 'fr', labelKey: 'locales.fr' },
      { value: 'de', labelKey: 'locales.de' },
      { value: 'it', labelKey: 'locales.it' },
      { value: 'pt', labelKey: 'locales.pt' },
      { value: 'nl', labelKey: 'locales.nl' },
      { value: 'zh', labelKey: 'locales.zh' },
    ],
  },
} as const satisfies FilterDefinitions;

export type CustomerFilters = typeof customerFilterDefinitions;

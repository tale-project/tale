/**
 * Vendor filter definitions
 *
 * Defines the filters available for the vendors table.
 * Used by both server-side URL parsing and client-side filter hooks.
 */

import type { FilterDefinitions } from '@/lib/pagination/types';

export const vendorFilterDefinitions = {
  query: {
    type: 'search' as const,
    urlKey: 'query',
    placeholderKey: 'vendors.searchPlaceholder',
    debounceMs: 300,
  },
  source: {
    type: 'multiSelect' as const,
    titleKey: 'tables.headers.source',
    options: [
      { value: 'manual_import', labelKey: 'vendors.filter.source.manual' },
      { value: 'file_upload', labelKey: 'vendors.filter.source.upload' },
      { value: 'circuly', labelKey: 'vendors.filter.source.circuly' },
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

export type VendorFilters = typeof vendorFilterDefinitions;

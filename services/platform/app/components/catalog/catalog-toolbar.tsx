'use client';

import { HStack, Stack } from '@tale/ui/layout';
import { Tabs, type TabItem } from '@tale/ui/tabs';
import { type ChangeEvent, type ReactNode } from 'react';

import {
  SearchInput,
  TOOLBAR_SEARCH_WRAPPER,
} from '@/app/components/ui/forms/search-input';

/**
 * The header every catalog surface shares. With tabs it is two rows — the
 * strip leads, and below it the search plus its facet controls (left) face the
 * optional action (right); without tabs it collapses to that one row. Keeping
 * this a single shared component is what keeps the catalogs' toolbars
 * pixel-identical (one search width, one gap scale).
 *
 * `filters` and `action` are deliberately separate slots. Facets narrow what
 * the grid shows, so they sit with the search that does the same job; `action`
 * is the surface's primary verb (Add, Refresh) and stays opposite them. Before
 * this split every surface crammed its facets into `action`, which put "Add
 * skill" and "filter by label" in one undifferentiated cluster.
 *
 * `search` is optional so a tab strip can select something that ISN'T a grid —
 * the providers page's read-only harness report, for one. Omitting it
 * drops the whole second row rather than leaving an inert search box that
 * narrows nothing.
 *
 * The caller owns the step BELOW it, and it is 16px: put this and the grid it
 * narrows in one `<Stack gap={4}>`, the same distance a table page's filter bar
 * sits above its table. Dropping it straight into `SettingsPage` instead
 * inherits that page's 32px section rhythm, which reads as a detached header.
 */

interface CatalogToolbarTabs {
  items: TabItem[];
  value: string;
  onValueChange: (value: string) => void;
}

interface CatalogToolbarSearch {
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  placeholder: string;
  disabled?: boolean;
}

interface CatalogToolbarProps {
  /** Optional leading tab strip (e.g. All / Connected / Available). */
  tabs?: CatalogToolbarTabs;
  /** Omit to render the tab strip alone (a tab that selects no grid). */
  search?: CatalogToolbarSearch;
  /**
   * Facet controls that narrow the grid — a `CatalogFilterButton`, which holds
   * every facet group behind one trigger — rendered beside the search.
   */
  filters?: ReactNode;
  /** Right-aligned primary action (e.g. the Add dropdown, Refresh). */
  action?: ReactNode;
  className?: string;
}

export function CatalogToolbar({
  tabs,
  search,
  filters,
  action,
  className,
}: CatalogToolbarProps) {
  const searchRow = search && (
    <HStack wrap justify="between" align="center" gap={4}>
      {/* gap-3 and the shared search width, both matching `DataTableFilters`:
          search and its filter button sit the same distance apart, and the box
          they follow is the same size, on a catalog as on a table page. */}
      <HStack wrap align="center" gap={3}>
        <SearchInput
          value={search.value}
          onChange={search.onChange}
          placeholder={search.placeholder}
          disabled={search.disabled}
          className="max-w-none"
          wrapperClassName={TOOLBAR_SEARCH_WRAPPER}
        />
        {filters}
      </HStack>
      {action}
    </HStack>
  );

  if (!tabs) {
    return <div className={className}>{searchRow}</div>;
  }

  return (
    <Stack gap={4} className={className}>
      <Tabs
        variant="underline"
        items={tabs.items}
        value={tabs.value}
        onValueChange={tabs.onValueChange}
      />
      {searchRow}
    </Stack>
  );
}

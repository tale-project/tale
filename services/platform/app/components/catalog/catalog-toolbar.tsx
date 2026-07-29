'use client';

import { HStack, Stack } from '@tale/ui/layout';
import { Tabs, type TabItem } from '@tale/ui/tabs';
import { type ChangeEvent, type ReactNode } from 'react';

import { SearchInput } from '@/app/components/ui/forms/search-input';

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
  search: CatalogToolbarSearch;
  /**
   * Facet controls that narrow the grid (a `MultiSelect` or two), rendered
   * beside the search. Give each one an explicit width — they share the row
   * with the search and must not stretch.
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
  const searchRow = (
    <HStack wrap justify="between" align="center" gap={4}>
      <HStack wrap align="center" gap={2}>
        <SearchInput
          value={search.value}
          onChange={search.onChange}
          placeholder={search.placeholder}
          disabled={search.disabled}
          className="w-64"
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

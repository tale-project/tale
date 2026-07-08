'use client';

import { HStack, Stack } from '@tale/ui/layout';
import { Tabs, type TabItem } from '@tale/ui/tabs';
import { type ChangeEvent, type ReactNode } from 'react';

import { SearchInput } from '@/app/components/ui/forms/search-input';

/**
 * The header every catalog surface shares. With tabs it is two rows — the
 * pill strip leads, and below it the search (left) faces the optional action
 * (right); without tabs it collapses to that one search/action row. Keeping
 * this a single shared component is what keeps the catalogs' toolbars
 * pixel-identical (one search width, one gap scale).
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
  /** Optional leading pill tab strip (e.g. Installed / All). */
  tabs?: CatalogToolbarTabs;
  search: CatalogToolbarSearch;
  /** Right-aligned action slot (e.g. the Add dropdown). */
  action?: ReactNode;
  className?: string;
}

export function CatalogToolbar({
  tabs,
  search,
  action,
  className,
}: CatalogToolbarProps) {
  const searchRow = (
    <HStack wrap justify="between" align="center" gap={4}>
      <SearchInput
        value={search.value}
        onChange={search.onChange}
        placeholder={search.placeholder}
        disabled={search.disabled}
        className="w-64"
      />
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

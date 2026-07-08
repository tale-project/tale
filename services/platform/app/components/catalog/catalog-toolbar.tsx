'use client';

import { HStack } from '@tale/ui/layout';
import { Tabs, type TabItem } from '@tale/ui/tabs';
import { type ChangeEvent, type ReactNode } from 'react';

import { SearchInput } from '@/app/components/ui/forms/search-input';

/**
 * The one-row header every catalog surface shares: `[tabs?] … [search] …
 * [action?]`. With tabs the pill strip leads and the search right-aligns next
 * to the optional action; without tabs the search leads and the action stays
 * right-aligned. Keeping the row a single shared component is what keeps the
 * catalogs' toolbars pixel-identical (one search width, one gap scale).
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
  const searchInput = (
    <SearchInput
      value={search.value}
      onChange={search.onChange}
      placeholder={search.placeholder}
      disabled={search.disabled}
      className="w-64"
    />
  );

  return (
    <HStack wrap justify="between" align="center" gap={4} className={className}>
      {tabs ? (
        <Tabs
          items={tabs.items}
          value={tabs.value}
          onValueChange={tabs.onValueChange}
        />
      ) : (
        searchInput
      )}
      {tabs || action ? (
        <HStack gap={3} align="center">
          {tabs ? searchInput : null}
          {action}
        </HStack>
      ) : null}
    </HStack>
  );
}

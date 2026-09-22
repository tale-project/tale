import { useMemo } from 'react';

import { useCatalogSearch } from './use-catalog-search';

/**
 * The one narrowing pipeline every card catalog runs: scope tab → facet
 * selection → text search, in that order, all client-side over an unpaginated
 * listing.
 *
 * Order is deliberate. The tab and the facets answer "which slice of my
 * catalog", the search answers "which item in that slice"; running the search
 * first would make the facet option list depend on the query and options would
 * flicker away as the reader types.
 *
 * Facet options come from the FULL listing, not the narrowed one, so selecting
 * a label never removes the other labels you might want next.
 *
 * Every catalog names its unnarrowed tab `'all'`; `hasActiveFilters` relies on
 * that to tell "you own nothing" from "nothing matches".
 *
 * `matchesTab`, `facetValuesOf` and `getHaystack` must be referentially stable
 * (module-level functions or `useCallback`) — they are memo dependencies.
 */

interface CatalogFacetsInput<T, Tab extends string> {
  items: readonly T[];
  /** Active scope tab. */
  tab: Tab;
  /** True when `item` belongs on `tab`. */
  matchesTab: (item: T, tab: Tab) => boolean;
  /** The facet values an item carries (labels, tags, API formats…). */
  facetValuesOf: (item: T) => readonly string[];
  /** Currently selected facet values. Empty = no narrowing. */
  selectedFacets: readonly string[];
  query: string;
  getHaystack: (item: T) => ReadonlyArray<string | undefined>;
}

interface CatalogFacetsResult<T> {
  /** Items surviving tab + facets + search, in listing order. */
  filtered: T[];
  /** Every facet value in the full listing, deduplicated and sorted. */
  facetOptions: string[];
  /** True when the reader has narrowed at all — drives the no-results copy. */
  hasActiveFilters: boolean;
}

export function useCatalogFacets<T, Tab extends string>({
  items,
  tab,
  matchesTab,
  facetValuesOf,
  selectedFacets,
  query,
  getHaystack,
}: CatalogFacetsInput<T, Tab>): CatalogFacetsResult<T> {
  const scoped = useMemo(
    () =>
      items.filter((item) => {
        if (!matchesTab(item, tab)) return false;
        if (selectedFacets.length === 0) return true;
        // AND semantics: an item must carry EVERY selected value. Narrowing
        // that widens the result set as you add criteria reads as broken.
        const own = new Set(facetValuesOf(item));
        return selectedFacets.every((value) => own.has(value));
      }),
    [items, tab, matchesTab, selectedFacets, facetValuesOf],
  );

  const filtered = useCatalogSearch(scoped, query, getHaystack);

  const facetOptions = useMemo(() => {
    const values = new Set<string>();
    for (const item of items) {
      for (const value of facetValuesOf(item)) values.add(value);
    }
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [items, facetValuesOf]);

  return {
    filtered,
    facetOptions,
    hasActiveFilters:
      query.trim().length > 0 || selectedFacets.length > 0 || tab !== 'all',
  };
}

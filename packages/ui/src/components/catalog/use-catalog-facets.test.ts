// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useCatalogFacets } from './use-catalog-facets';

interface Item {
  slug: string;
  description: string;
  scope: 'org' | 'team';
  tags: string[];
}

const ITEMS: Item[] = [
  {
    slug: 'github',
    description: 'Pull requests',
    scope: 'org',
    tags: ['dev', 'code'],
  },
  { slug: 'slack', description: 'Team chat', scope: 'team', tags: ['chat'] },
  { slug: 'gmail', description: 'Mail', scope: 'org', tags: ['chat', 'dev'] },
];

const matchesTab = (item: Item, tab: 'all' | 'org' | 'team') =>
  tab === 'all' ? true : item.scope === tab;
const facetValuesOf = (item: Item) => item.tags;
const getHaystack = (item: Item) => [item.slug, item.description];

function run(
  over: Partial<
    Parameters<typeof useCatalogFacets<Item, 'all' | 'org' | 'team'>>[0]
  > = {},
) {
  return renderHook(() =>
    useCatalogFacets<Item, 'all' | 'org' | 'team'>({
      items: ITEMS,
      tab: 'all',
      matchesTab,
      facetValuesOf,
      selectedFacets: [],
      query: '',
      getHaystack,
      ...over,
    }),
  ).result.current;
}

describe('useCatalogFacets', () => {
  it('returns everything with no narrowing applied', () => {
    const r = run();
    expect(r.filtered.map((i) => i.slug)).toEqual(['github', 'slack', 'gmail']);
    expect(r.hasActiveFilters).toBe(false);
  });

  it('narrows by scope tab', () => {
    expect(run({ tab: 'org' }).filtered.map((i) => i.slug)).toEqual([
      'github',
      'gmail',
    ]);
    expect(run({ tab: 'team' }).filtered.map((i) => i.slug)).toEqual(['slack']);
  });

  it('requires EVERY selected facet, so adding one never widens the result', () => {
    expect(
      run({ selectedFacets: ['dev'] }).filtered.map((i) => i.slug),
    ).toEqual(['github', 'gmail']);
    expect(
      run({ selectedFacets: ['dev', 'chat'] }).filtered.map((i) => i.slug),
    ).toEqual(['gmail']);
  });

  it('searches the haystack case-insensitively', () => {
    expect(run({ query: 'MAIL' }).filtered.map((i) => i.slug)).toEqual([
      'gmail',
    ]);
    expect(run({ query: 'pull requests' }).filtered.map((i) => i.slug)).toEqual(
      ['github'],
    );
  });

  it('composes tab, facets and search', () => {
    const r = run({ tab: 'org', selectedFacets: ['chat'], query: 'ma' });
    expect(r.filtered.map((i) => i.slug)).toEqual(['gmail']);
    expect(r.hasActiveFilters).toBe(true);
  });

  it('derives facet options from the FULL listing, not the narrowed one', () => {
    // Selecting `chat` must not hide `code`, or the reader cannot pick it next.
    const r = run({ tab: 'team', selectedFacets: ['chat'] });
    expect(r.facetOptions).toEqual(['chat', 'code', 'dev']);
  });

  it('reports active filters for a non-all tab even with no query or facet', () => {
    expect(run({ tab: 'org' }).hasActiveFilters).toBe(true);
    expect(run({ query: '   ' }).hasActiveFilters).toBe(false);
  });
});

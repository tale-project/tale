// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useCatalogSearch } from './use-catalog-search';

interface Item {
  name: string;
  description?: string;
  labels?: string[];
}

function haystack(item: Item): ReadonlyArray<string | undefined> {
  return [item.name, item.description, ...(item.labels ?? [])];
}

const ITEMS: Item[] = [
  { name: 'GitHub Sync', description: 'Keeps issues aligned.' },
  { name: 'Mailroom', description: 'Sorts the inbox', labels: ['Email'] },
  { name: 'Sparse' },
];

describe('useCatalogSearch', () => {
  it('returns every item for an empty or whitespace-only query', () => {
    const { result: empty } = renderHook(() =>
      useCatalogSearch(ITEMS, '', haystack),
    );
    expect(empty.current).toHaveLength(3);

    const { result: blank } = renderHook(() =>
      useCatalogSearch(ITEMS, '   ', haystack),
    );
    expect(blank.current).toHaveLength(3);
  });

  it('matches case-insensitively with a trimmed substring', () => {
    const { result } = renderHook(() =>
      useCatalogSearch(ITEMS, '  gitHUB ', haystack),
    );
    expect(result.current.map((i) => i.name)).toStrictEqual(['GitHub Sync']);
  });

  it('matches any haystack field, including labels', () => {
    const { result } = renderHook(() =>
      useCatalogSearch(ITEMS, 'email', haystack),
    );
    expect(result.current.map((i) => i.name)).toStrictEqual(['Mailroom']);
  });

  it('tolerates undefined haystack entries', () => {
    const { result } = renderHook(() =>
      useCatalogSearch(ITEMS, 'sparse', haystack),
    );
    expect(result.current.map((i) => i.name)).toStrictEqual(['Sparse']);
  });

  it('returns an empty list when nothing matches', () => {
    const { result } = renderHook(() =>
      useCatalogSearch(ITEMS, 'zzz-nomatch', haystack),
    );
    expect(result.current).toStrictEqual([]);
  });
});

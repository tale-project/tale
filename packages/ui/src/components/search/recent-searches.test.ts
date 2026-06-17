import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearRecentSearches,
  loadRecentSearches,
  removeRecentSearch,
  saveRecentSearch,
} from './recent-searches';

const KEY = 'tale.test.recentSearches.v1';

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('loadRecentSearches', () => {
  it('returns [] when storage is empty', () => {
    expect(loadRecentSearches(KEY)).toEqual([]);
  });

  it('returns the stored array', () => {
    const entries = [
      { query: 'rag', savedAt: 100 },
      { query: 'cli', savedAt: 200 },
    ];
    window.localStorage.setItem(KEY, JSON.stringify(entries));
    expect(loadRecentSearches(KEY)).toEqual(entries);
  });

  it('caps results at the storage maximum', () => {
    const entries = Array.from({ length: 12 }, (_, i) => ({
      query: `q${i}`,
      savedAt: i,
    }));
    window.localStorage.setItem(KEY, JSON.stringify(entries));
    expect(loadRecentSearches(KEY)).toHaveLength(6);
  });

  it('returns [] when stored value is not valid JSON', () => {
    window.localStorage.setItem(KEY, '{not json}');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadRecentSearches(KEY)).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('returns [] when stored value is not an array', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ q: 'rag' }));
    expect(loadRecentSearches(KEY)).toEqual([]);
  });

  it('filters out entries that fail the shape check', () => {
    const entries = [
      { query: 'good', savedAt: 1 },
      { query: 123, savedAt: 2 },
      { savedAt: 3 },
      { query: '', savedAt: 4 },
      { query: 'fine', savedAt: 'nope' },
      { query: 'all-good', savedAt: 5, href: '/x', title: 'X' },
    ];
    window.localStorage.setItem(KEY, JSON.stringify(entries));
    const result = loadRecentSearches(KEY);
    expect(result.map((r) => r.query)).toEqual(['good', 'all-good']);
  });

  it('namespaces by key — a different key sees nothing', () => {
    saveRecentSearch(KEY, { query: 'rag' });
    expect(loadRecentSearches('tale.other.v1')).toEqual([]);
  });
});

describe('saveRecentSearch', () => {
  it('prepends a fresh entry to the list', () => {
    saveRecentSearch(KEY, { query: 'rag', href: '/rag', title: 'RAG' });
    const stored = loadRecentSearches(KEY);
    expect(stored[0]?.query).toBe('rag');
    expect(stored[0]?.href).toBe('/rag');
    expect(typeof stored[0]?.savedAt).toBe('number');
  });

  it('returns the current list and ignores blank/whitespace queries', () => {
    saveRecentSearch(KEY, { query: 'rag' });
    const out = saveRecentSearch(KEY, { query: '   ' });
    expect(out.map((r) => r.query)).toEqual(['rag']);
  });

  it('dedupes case-insensitively, keeping the most recent at the top', () => {
    saveRecentSearch(KEY, { query: 'RAG' });
    saveRecentSearch(KEY, { query: 'CLI' });
    saveRecentSearch(KEY, { query: 'rag' });
    const stored = loadRecentSearches(KEY);
    expect(stored.map((r) => r.query)).toEqual(['rag', 'CLI']);
  });

  it('caps the stored list at the maximum (6)', () => {
    for (let i = 0; i < 10; i += 1) saveRecentSearch(KEY, { query: `q${i}` });
    const stored = loadRecentSearches(KEY);
    expect(stored).toHaveLength(6);
    expect(stored[0]?.query).toBe('q9');
  });

  it('trims whitespace from the saved query', () => {
    saveRecentSearch(KEY, { query: '  rag  ' });
    expect(loadRecentSearches(KEY)[0]?.query).toBe('rag');
  });
});

describe('removeRecentSearch', () => {
  it('removes a matching entry case-insensitively', () => {
    saveRecentSearch(KEY, { query: 'rag' });
    saveRecentSearch(KEY, { query: 'cli' });
    const remaining = removeRecentSearch(KEY, 'RAG');
    expect(remaining.map((r) => r.query)).toEqual(['cli']);
    expect(loadRecentSearches(KEY).map((r) => r.query)).toEqual(['cli']);
  });

  it('is a no-op when the query is not present', () => {
    saveRecentSearch(KEY, { query: 'rag' });
    expect(removeRecentSearch(KEY, 'missing').map((r) => r.query)).toEqual([
      'rag',
    ]);
  });
});

describe('clearRecentSearches', () => {
  it('empties the stored list', () => {
    saveRecentSearch(KEY, { query: 'rag' });
    expect(loadRecentSearches(KEY)).toHaveLength(1);
    clearRecentSearches(KEY);
    expect(loadRecentSearches(KEY)).toEqual([]);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});

describe('SSR safety', () => {
  it('returns [] from load when window is undefined', () => {
    vi.stubGlobal('window', undefined);
    try {
      expect(loadRecentSearches(KEY)).toEqual([]);
      expect(saveRecentSearch(KEY, { query: 'rag' })).toEqual([]);
      expect(removeRecentSearch(KEY, 'rag')).toEqual([]);
      expect(() => clearRecentSearches(KEY)).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('write resilience', () => {
  it('warns but does not throw when setItem fails', () => {
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() =>
      saveRecentSearch(KEY, { query: 'rag', href: '/rag' }),
    ).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    setItem.mockRestore();
  });
});

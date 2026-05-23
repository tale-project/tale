import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearRecentSearches,
  loadRecentSearches,
  removeRecentSearch,
  saveRecentSearch,
} from './recent-searches';

const STORAGE_KEY = 'tale.docs.recentSearches.v1';

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('loadRecentSearches', () => {
  it('returns [] when storage is empty', () => {
    expect(loadRecentSearches()).toEqual([]);
  });

  it('returns the stored array', () => {
    const entries = [
      { query: 'rag', savedAt: 100 },
      { query: 'cli', savedAt: 200 },
    ];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    expect(loadRecentSearches()).toEqual(entries);
  });

  it('caps results at the storage maximum', () => {
    const entries = Array.from({ length: 12 }, (_, i) => ({
      query: `q${i}`,
      savedAt: i,
    }));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    expect(loadRecentSearches()).toHaveLength(6);
  });

  it('returns [] when stored value is not valid JSON', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json}');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadRecentSearches()).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('returns [] when stored value is not an array', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ q: 'rag' }));
    expect(loadRecentSearches()).toEqual([]);
  });

  it('filters out entries that fail the shape check', () => {
    const entries = [
      { query: 'good', savedAt: 1 },
      { query: 123, savedAt: 2 }, // bad: query is not a string
      { savedAt: 3 }, // bad: missing query
      { query: '', savedAt: 4 }, // bad: empty query
      { query: 'fine', savedAt: 'nope' }, // bad: savedAt wrong type
      { query: 'all-good', savedAt: 5, url: '/x', title: 'X' },
    ];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    const result = loadRecentSearches();
    expect(result.map((r) => r.query)).toEqual(['good', 'all-good']);
  });
});

describe('saveRecentSearch', () => {
  it('prepends a fresh entry to the list', () => {
    saveRecentSearch({ query: 'rag', url: '/rag', title: 'RAG' });
    const stored = loadRecentSearches();
    expect(stored[0]?.query).toBe('rag');
    expect(stored[0]?.url).toBe('/rag');
    expect(typeof stored[0]?.savedAt).toBe('number');
  });

  it('returns the current list and ignores blank/whitespace queries', () => {
    saveRecentSearch({ query: 'rag' });
    const out = saveRecentSearch({ query: '   ' });
    expect(out.map((r) => r.query)).toEqual(['rag']);
  });

  it('dedupes case-insensitively, keeping the most recent at the top', () => {
    saveRecentSearch({ query: 'RAG' });
    saveRecentSearch({ query: 'CLI' });
    saveRecentSearch({ query: 'rag' }); // duplicate of RAG, case-different
    const stored = loadRecentSearches();
    expect(stored.map((r) => r.query)).toEqual(['rag', 'CLI']);
  });

  it('caps the stored list at the maximum (6)', () => {
    for (let i = 0; i < 10; i += 1) saveRecentSearch({ query: `q${i}` });
    const stored = loadRecentSearches();
    expect(stored).toHaveLength(6);
    // Newest first, so the last few inserts are at the top.
    expect(stored[0]?.query).toBe('q9');
  });

  it('trims whitespace from the saved query', () => {
    saveRecentSearch({ query: '  rag  ' });
    expect(loadRecentSearches()[0]?.query).toBe('rag');
  });
});

describe('removeRecentSearch', () => {
  it('removes a matching entry case-insensitively', () => {
    saveRecentSearch({ query: 'rag' });
    saveRecentSearch({ query: 'cli' });
    const remaining = removeRecentSearch('RAG');
    expect(remaining.map((r) => r.query)).toEqual(['cli']);
    expect(loadRecentSearches().map((r) => r.query)).toEqual(['cli']);
  });

  it('is a no-op when the query is not present', () => {
    saveRecentSearch({ query: 'rag' });
    expect(removeRecentSearch('missing').map((r) => r.query)).toEqual(['rag']);
  });
});

describe('clearRecentSearches', () => {
  it('empties the stored list', () => {
    saveRecentSearch({ query: 'rag' });
    expect(loadRecentSearches()).toHaveLength(1);
    clearRecentSearches();
    expect(loadRecentSearches()).toEqual([]);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe('SSR safety', () => {
  it('returns [] from load when window is undefined', () => {
    const originalWindow = globalThis.window;
    // oxlint-disable-next-line typescript/no-explicit-any -- simulate SSR
    (globalThis as any).window = undefined;
    try {
      expect(loadRecentSearches()).toEqual([]);
      expect(saveRecentSearch({ query: 'rag' })).toEqual([]);
      expect(removeRecentSearch('rag')).toEqual([]);
      // clearRecentSearches has no observable return; it should just not throw.
      expect(() => clearRecentSearches()).not.toThrow();
    } finally {
      // oxlint-disable-next-line typescript/no-explicit-any -- restore
      (globalThis as any).window = originalWindow;
    }
  });
});

describe('write resilience', () => {
  it('warns but does not throw when setItem fails', () => {
    const setItem = vi
      .spyOn(window.localStorage.__proto__, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => saveRecentSearch({ query: 'rag', url: '/rag' })).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    setItem.mockRestore();
  });
});

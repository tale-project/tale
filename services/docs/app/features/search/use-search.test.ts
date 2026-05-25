import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as client from './client';
import type { SearchResult } from './types';
import { useDocSearch } from './use-search';

function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: 'a',
    title: 'A',
    url: '/a',
    score: 1,
    matchedTerms: ['a'],
    queryTerms: ['a'],
    match: { a: ['title'] },
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(client, 'loadIndex').mockResolvedValue(
    // oxlint-disable-next-line typescript/no-explicit-any -- only loadIndex is observed by the hook
    {} as any,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useDocSearch', () => {
  it('starts idle with an empty results array', () => {
    const { result } = renderHook(() =>
      useDocSearch({ locale: 'en', debounceMs: 0, prefetch: false }),
    );
    expect(result.current.query).toBe('');
    expect(result.current.status).toBe('idle');
    expect(result.current.results).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('does not run a search below minQueryLength', async () => {
    const searchSpy = vi.spyOn(client, 'search').mockResolvedValue([]);
    const { result } = renderHook(() =>
      useDocSearch({
        locale: 'en',
        debounceMs: 0,
        prefetch: false,
        minQueryLength: 2,
      }),
    );
    act(() => result.current.setQuery('a'));
    await new Promise((r) => setTimeout(r, 5));
    expect(searchSpy).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('runs a search once the query reaches minQueryLength', async () => {
    const searchSpy = vi
      .spyOn(client, 'search')
      .mockResolvedValue([makeResult({ id: '1', title: 'Hit' })]);

    const { result } = renderHook(() =>
      useDocSearch({ locale: 'en', debounceMs: 0, prefetch: false }),
    );
    act(() => result.current.setQuery('rag'));

    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(searchSpy).toHaveBeenCalledWith('en', 'rag', '');
    expect(result.current.results).toHaveLength(1);
    expect(result.current.results[0]?.title).toBe('Hit');
  });

  it('debounces rapid keystrokes into a single search call', async () => {
    const searchSpy = vi.spyOn(client, 'search').mockResolvedValue([]);

    const { result } = renderHook(() =>
      useDocSearch({ locale: 'en', debounceMs: 50, prefetch: false }),
    );
    act(() => result.current.setQuery('co'));
    act(() => result.current.setQuery('con'));
    act(() => result.current.setQuery('config'));

    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(searchSpy).toHaveBeenCalledTimes(1);
    expect(searchSpy).toHaveBeenCalledWith('en', 'config', '');
  });

  it('surfaces errors as status="error" without crashing the hook', async () => {
    vi.spyOn(client, 'search').mockRejectedValue(new Error('network'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() =>
      useDocSearch({ locale: 'en', debounceMs: 0, prefetch: false }),
    );
    act(() => result.current.setQuery('rag'));

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.results).toEqual([]);
  });

  it('returns to idle when the query is cleared below minQueryLength', async () => {
    vi.spyOn(client, 'search').mockResolvedValue([
      makeResult({ id: '1', title: 'Hit' }),
    ]);

    const { result } = renderHook(() =>
      useDocSearch({ locale: 'en', debounceMs: 0, prefetch: false }),
    );
    act(() => result.current.setQuery('rag'));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => result.current.setQuery(''));
    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(result.current.results).toEqual([]);
  });

  it('cancels an in-flight search when the query changes', async () => {
    let resolveFirst: (rows: SearchResult[]) => void = () => {};
    const firstPromise = new Promise<SearchResult[]>((resolve) => {
      resolveFirst = resolve;
    });

    let call = 0;
    const searchSpy = vi.spyOn(client, 'search').mockImplementation(() => {
      call += 1;
      if (call === 1) return firstPromise;
      return Promise.resolve([makeResult({ id: '2', title: 'Second' })]);
    });

    const { result } = renderHook(() =>
      useDocSearch({ locale: 'en', debounceMs: 0, prefetch: false }),
    );
    act(() => result.current.setQuery('rag'));
    // Switch the query mid-flight; the first promise has not resolved.
    await new Promise((r) => setTimeout(r, 5));
    act(() => result.current.setQuery('cli'));

    await waitFor(() => {
      expect(result.current.results[0]?.title).toBe('Second');
    });

    // Now resolve the first promise — its result must NOT replace the second.
    resolveFirst([makeResult({ id: '1', title: 'First-LATE' })]);
    await new Promise((r) => setTimeout(r, 5));
    expect(result.current.results[0]?.title).toBe('Second');
    expect(searchSpy).toHaveBeenCalledTimes(2);
  });

  it('caps results to limit', async () => {
    vi.spyOn(client, 'search').mockResolvedValue([
      makeResult({ id: '1' }),
      makeResult({ id: '2' }),
      makeResult({ id: '3' }),
    ]);

    const { result } = renderHook(() =>
      useDocSearch({
        locale: 'en',
        debounceMs: 0,
        prefetch: false,
        limit: 2,
      }),
    );
    act(() => result.current.setQuery('rag'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.results).toHaveLength(2);
  });

  it('exposes deduplicated terms from the debounced query', async () => {
    vi.spyOn(client, 'search').mockResolvedValue([]);
    const { result } = renderHook(() =>
      useDocSearch({ locale: 'en', debounceMs: 0, prefetch: false }),
    );
    act(() => result.current.setQuery('config Config rag'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.terms).toEqual(['config', 'rag']);
  });

  it('prefetches the index on mount when prefetch is true', async () => {
    const loadSpy = vi.mocked(client.loadIndex);
    renderHook(() => useDocSearch({ locale: 'en', prefetch: true }));
    await new Promise((r) => setTimeout(r, 5));
    expect(loadSpy).toHaveBeenCalledWith('en', '');
  });
});

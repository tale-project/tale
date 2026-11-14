import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as client from './client';
import type { StaticSearchHit } from './types';
import { useStaticSearch } from './use-static-search';

const INDEX_URL = '/search-index-en.json';

function makeResult(overrides: Partial<StaticSearchHit> = {}): StaticSearchHit {
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

// `useStaticSearch` receives an already-debounced, already-gated query from
// the shared search controller — it just executes it. Debounce / min-length /
// query-state ownership are covered by the SearchCommand tests.
describe('useStaticSearch', () => {
  it('starts idle with an empty results array for an empty query', () => {
    const { result } = renderHook(() =>
      useStaticSearch({ query: '', indexUrl: INDEX_URL, prefetch: false }),
    );
    expect(result.current.status).toBe('idle');
    expect(result.current.results).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('runs a search for a non-empty query', async () => {
    const searchSpy = vi
      .spyOn(client, 'search')
      .mockResolvedValue([makeResult({ id: '1', title: 'Hit' })]);

    const { result } = renderHook(() =>
      useStaticSearch({ query: 'rag', indexUrl: INDEX_URL, prefetch: false }),
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(searchSpy).toHaveBeenCalledWith(INDEX_URL, 'rag');
    expect(result.current.results).toHaveLength(1);
    expect(result.current.results[0]?.title).toBe('Hit');
  });

  it('surfaces errors as status="error" without crashing', async () => {
    vi.spyOn(client, 'search').mockRejectedValue(new Error('network'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() =>
      useStaticSearch({ query: 'rag', indexUrl: INDEX_URL, prefetch: false }),
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.results).toEqual([]);
  });

  it('returns to idle when the query is cleared', async () => {
    vi.spyOn(client, 'search').mockResolvedValue([
      makeResult({ id: '1', title: 'Hit' }),
    ]);

    const { result, rerender } = renderHook(
      ({ query }: { query: string }) =>
        useStaticSearch({ query, indexUrl: INDEX_URL, prefetch: false }),
      { initialProps: { query: 'rag' } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));

    rerender({ query: '' });
    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(result.current.results).toEqual([]);
  });

  it('cancels an in-flight search when the query changes', async () => {
    let resolveFirst: (rows: StaticSearchHit[]) => void = () => {};
    const firstPromise = new Promise<StaticSearchHit[]>((resolve) => {
      resolveFirst = resolve;
    });

    let call = 0;
    const searchSpy = vi.spyOn(client, 'search').mockImplementation(() => {
      call += 1;
      if (call === 1) return firstPromise;
      return Promise.resolve([makeResult({ id: '2', title: 'Second' })]);
    });

    const { result, rerender } = renderHook(
      ({ query }: { query: string }) =>
        useStaticSearch({ query, indexUrl: INDEX_URL, prefetch: false }),
      { initialProps: { query: 'rag' } },
    );
    await new Promise((r) => setTimeout(r, 5));
    rerender({ query: 'cli' });

    await waitFor(() =>
      expect(result.current.results[0]?.title).toBe('Second'),
    );

    // Resolve the first promise late — it must NOT replace the second result.
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
      useStaticSearch({
        query: 'rag',
        indexUrl: INDEX_URL,
        prefetch: false,
        limit: 2,
      }),
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.results).toHaveLength(2);
  });

  it('exposes deduplicated terms from the query', async () => {
    vi.spyOn(client, 'search').mockResolvedValue([]);
    const { result } = renderHook(() =>
      useStaticSearch({
        query: 'config Config rag',
        indexUrl: INDEX_URL,
        prefetch: false,
      }),
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.terms).toEqual(['config', 'rag']);
  });

  it('prefetches the index on mount when prefetch is true', async () => {
    const loadSpy = vi.mocked(client.loadIndex);
    renderHook(() =>
      useStaticSearch({ query: '', indexUrl: INDEX_URL, prefetch: true }),
    );
    await new Promise((r) => setTimeout(r, 5));
    expect(loadSpy).toHaveBeenCalledWith(INDEX_URL);
  });
});

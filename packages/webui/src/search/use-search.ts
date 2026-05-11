import { useEffect, useState } from 'react';

import { useDebounce } from '../hooks/use-debounce';
import { loadIndex, search } from './client';
import { extractTerms } from './snippet';
import type { SearchResult, SearchStatus } from './types';

interface UseSearchOptions {
  locale: string;
  baseUrl?: string;
  /** Cap the number of results forwarded to the UI. */
  limit?: number;
  /** Debounce window in milliseconds. */
  debounceMs?: number;
  /** Don't run a search until the trimmed query reaches this length. Single
   *  characters surface noise; the threshold also avoids prefix-scanning a
   *  large index for nearly every letter typed. */
  minQueryLength?: number;
  /** Pre-fetch the index as soon as the hook mounts so the first keystroke
   *  hits a hot cache. */
  prefetch?: boolean;
}

interface UseSearchReturn {
  query: string;
  setQuery: (next: string) => void;
  results: SearchResult[];
  /** Lower-cased, deduped query tokens — for highlight + snippet centring
   *  fallback when a result has no `matchedTerms`. */
  terms: string[];
  status: SearchStatus;
  error: Error | null;
}

/** Debounced search hook backed by the static MiniSearch index. Tracks
 *  loading/ready/error states so the UI can render skeletons or messages
 *  appropriately, and re-runs whenever locale or query change. */
export function useDocSearch({
  locale,
  baseUrl = '',
  limit = 25,
  debounceMs = 120,
  minQueryLength = 2,
  prefetch = true,
}: UseSearchOptions): UseSearchReturn {
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, debounceMs);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [error, setError] = useState<Error | null>(null);

  // Pre-warm the index so the first real query doesn't pay the fetch cost.
  useEffect(() => {
    if (!prefetch) return;
    void loadIndex(locale, baseUrl).catch((err: unknown) => {
      // Non-fatal — the search effect will retry and surface the error there.
      console.warn('[search] index prefetch failed', err);
    });
  }, [locale, baseUrl, prefetch]);

  useEffect(() => {
    const trimmed = debounced.trim();
    if (trimmed.length < minQueryLength) {
      setResults([]);
      setStatus('idle');
      setError(null);
      return;
    }

    let cancelled = false;
    setStatus('loading');
    setError(null);

    void search(locale, trimmed, baseUrl)
      .then((rows) => {
        if (cancelled) return;
        setResults(rows.slice(0, limit));
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const wrapped =
          err instanceof Error ? err : new Error('[search] unknown error');
        console.error('[search] query failed', wrapped);
        setError(wrapped);
        setResults([]);
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [debounced, locale, baseUrl, limit, minQueryLength]);

  return {
    query,
    setQuery,
    results,
    terms: extractTerms(debounced),
    status,
    error,
  };
}

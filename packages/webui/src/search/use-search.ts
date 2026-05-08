import { useEffect, useState } from 'react';

import { useDebounce } from '../hooks/use-debounce';
import { search } from './client';
import { extractTerms } from './snippet';
import type { SearchResult, SearchStatus } from './types';

interface UseSearchOptions {
  locale: string;
  baseUrl?: string;
  /** Cap the number of results forwarded to the UI. */
  limit?: number;
  /** Debounce window in milliseconds. */
  debounceMs?: number;
}

interface UseSearchReturn {
  query: string;
  setQuery: (next: string) => void;
  results: SearchResult[];
  /** Lower-cased, deduped query tokens — for highlight + snippet centring. */
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
  debounceMs = 180,
}: UseSearchOptions): UseSearchReturn {
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, debounceMs);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const trimmed = debounced.trim();
    if (!trimmed) {
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
  }, [debounced, locale, baseUrl, limit]);

  return {
    query,
    setQuery,
    results,
    terms: extractTerms(debounced),
    status,
    error,
  };
}

import { extractTerms } from '@tale/ui/search/snippet';
import { useEffect, useState } from 'react';

import { loadIndex, search } from './client';
import type { SearchResult, SearchStatus } from './types';

interface UseDocSearchOptions {
  /** The query to run. Already debounced + min-length-gated by the shared
   *  search controller — this hook just executes it (empty ⇒ idle). */
  query: string;
  locale: string;
  baseUrl?: string;
  /** Cap the number of results forwarded to the UI. */
  limit?: number;
  /** Pre-fetch the index so the first real query hits a hot cache. Driven by
   *  the dialog's open/active state. */
  prefetch?: boolean;
}

interface UseDocSearchReturn {
  results: SearchResult[];
  /** Lower-cased, deduped query tokens — for highlight + snippet centring. */
  terms: string[];
  status: SearchStatus;
  error: Error | null;
}

/** Runs the static MiniSearch index for a given (already-debounced) query and
 *  tracks loading/ready/error so the shared palette can render skeletons or
 *  messages. The query/debounce/min-length live in the shared controller. */
export function useDocSearch({
  query,
  locale,
  baseUrl = '',
  limit = 25,
  prefetch = true,
}: UseDocSearchOptions): UseDocSearchReturn {
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
    const trimmed = query.trim();
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
  }, [query, locale, baseUrl, limit]);

  return {
    results,
    terms: extractTerms(query),
    status,
    error,
  };
}

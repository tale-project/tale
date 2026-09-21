import { useEffect, useState } from 'react';

import { extractTerms } from '../snippet';
import type { SearchStatus } from '../types';
import { loadIndex, search } from './client';
import type { StaticSearchHit } from './types';

interface UseStaticSearchOptions {
  /** The query to run. Already debounced + min-length-gated by the shared
   *  search controller — this hook just executes it (empty ⇒ idle). */
  query: string;
  /** URL of the static index to query. */
  indexUrl: string;
  /** Cap the number of results forwarded to the UI. */
  limit?: number;
  /** Pre-fetch the index so the first real query hits a hot cache. Driven by
   *  the dialog's open/active state. */
  prefetch?: boolean;
}

interface UseStaticSearchReturn {
  results: StaticSearchHit[];
  /** Lower-cased, deduped query tokens — for highlight + snippet centring. */
  terms: string[];
  status: SearchStatus;
  error: Error | null;
}

/** Runs the static MiniSearch index for a given (already-debounced) query and
 *  tracks loading/ready/error so the shared palette can render skeletons or
 *  messages. The query/debounce/min-length live in the shared controller. */
export function useStaticSearch({
  query,
  indexUrl,
  limit = 25,
  prefetch = true,
}: UseStaticSearchOptions): UseStaticSearchReturn {
  const [results, setResults] = useState<StaticSearchHit[]>([]);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [error, setError] = useState<Error | null>(null);

  // Pre-warm the index so the first real query doesn't pay the fetch cost.
  useEffect(() => {
    if (!prefetch) return;
    void loadIndex(indexUrl).catch((err: unknown) => {
      // Non-fatal — the search effect will retry and surface the error there.
      console.warn('[search] index prefetch failed', err);
    });
  }, [indexUrl, prefetch]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setStatus('idle');
      setError(null);
      return undefined;
    }

    let cancelled = false;
    setStatus('loading');
    setError(null);

    void search(indexUrl, trimmed)
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
  }, [query, indexUrl, limit]);

  return {
    results,
    terms: extractTerms(query),
    status,
    error,
  };
}

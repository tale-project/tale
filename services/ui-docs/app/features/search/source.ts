import type {
  SearchResult as SharedResult,
  SearchSource,
} from '@tale/ui/search';

import type { SearchResult as DocHit } from './types';
import { useDocSearch } from './use-search';

/** Map a MiniSearch hit onto the normalised shape the shared palette renders
 *  (`url → href`, `section → group`). The rich fields flow through so the
 *  shared row still extracts and highlights a snippet. */
function toSharedResult(hit: DocHit): SharedResult {
  return {
    id: hit.id,
    title: hit.title,
    href: hit.url,
    group: hit.section,
    body: hit.body,
    matchedTerms: hit.matchedTerms,
    queryTerms: hit.queryTerms,
    match: hit.match,
    score: hit.score,
  };
}

/**
 * Build a {@link SearchSource} backed by the static index. Returned from a
 * `useMemo` in the dialog so its identity — and the order of the hooks it
 * calls — stays stable across renders, which the hook-shaped source contract
 * requires.
 */
export function createUiDocsSearchSource(opts: {
  baseUrl?: string;
  limit?: number;
}): SearchSource {
  return (query, { open }) => {
    const { results, terms, status, error } = useDocSearch({
      query,
      baseUrl: opts.baseUrl,
      limit: opts.limit,
      // Warm the index as soon as the dialog opens, before the first query.
      prefetch: open,
    });
    return { results: results.map(toSharedResult), terms, status, error };
  };
}

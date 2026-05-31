import type {
  SearchResult as SharedResult,
  SearchSource,
} from '@tale/ui/search';

import type { SearchResult as DocHit } from './types';
import { useDocSearch } from './use-search';

/** Map a docs MiniSearch hit onto the shared, normalised result shape the
 *  palette renders. `url → href`, `section → group`; the rich fields
 *  (`body`/`matchedTerms`/`queryTerms`/`match`) flow through so the shared row
 *  still extracts + highlights a snippet and picks the title/heading/body
 *  icon. */
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
 * Build a {@link SearchSource} backed by the static, per-locale MiniSearch
 * index. Returned from a `useMemo` in the dialog so its identity (and the
 * order of the hooks it calls) stays stable across renders — a requirement of
 * the hook-shaped source contract.
 */
export function createDocsSearchSource(opts: {
  locale: string;
  baseUrl?: string;
  limit?: number;
}): SearchSource {
  return (query, { open }) => {
    const { results, terms, status, error } = useDocSearch({
      query,
      locale: opts.locale,
      baseUrl: opts.baseUrl,
      limit: opts.limit,
      // Warm the index as soon as the dialog opens, before the first real
      // query — `open` (not `active`, which also requires the min query length).
      prefetch: open,
    });
    return {
      results: results.map(toSharedResult),
      terms,
      status,
      error,
    };
  };
}

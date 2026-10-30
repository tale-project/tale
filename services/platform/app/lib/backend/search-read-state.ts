import type { SearchResult, SearchSourceState } from '@tale/ui/search';

import { type ReadQueryState, readStateOf } from './read-state';

/** A ⌘K source's backend read, as `useBackendQuery` hands it over. */
export interface SearchReadQuery extends ReadQueryState {
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<unknown>;
}

/**
 * A ⌘K source's state from its read, by the read-state rule
 * (`read-state.ts`). A read that never answered is the palette's `error`,
 * never "no results" (#4890): it carries a retry, and it holds through that
 * retry until the read settles, so its **Try again** stays busy instead of
 * giving way to the skeleton. A read that answered keeps its rows, even when
 * a refresh of them failed.
 */
export function searchStateOf<TData>(
  query: SearchReadQuery,
  results: SearchResult<TData>[],
): SearchSourceState<TData> {
  const read = readStateOf(query);
  if (read.unavailable) {
    const { refetch } = query;
    return {
      results,
      status: 'error',
      error: query.error,
      retry: () => void refetch(),
      retrying: read.retrying,
    };
  }
  return {
    results,
    status: query.isLoading || query.isFetching ? 'loading' : 'ready',
  };
}

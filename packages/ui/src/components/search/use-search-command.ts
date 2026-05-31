'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useDebounce } from '../../hooks/use-debounce';
import { flattenGroups, groupResults, type ResultGroup } from './group-by';
import {
  clearRecentSearches,
  loadRecentSearches,
  removeRecentSearch,
  saveRecentSearch,
} from './recent-searches';
import { extractTerms } from './snippet';
import type {
  RecentSearch,
  SearchResult,
  SearchSource,
  SearchStatus,
} from './types';

/** Stable empty array for the below-min-length case. */
const EMPTY_RESULTS: SearchResult[] = [];

export interface UseSearchCommandOptions {
  /** The data source hook — called once, unconditionally, each render. */
  source: SearchSource;
  /** Whether the command is open (drives reset + recents hydration). */
  open: boolean;
  /** Minimum trimmed query length before the source runs. */
  minQueryLength?: number;
  /** Debounce window applied to the query before it reaches the source. */
  debounceMs?: number;
  getGroupKey?: (result: SearchResult) => string;
  getGroupLabel?: (key: string) => string;
  /** localStorage key for recents. Omit to disable recents for this surface. */
  recentsStorageKey?: string;
  /** Caller-owned navigation/side-effect when a result is chosen. */
  onSelect: (result: SearchResult) => void;
}

export interface SearchCommandController {
  query: string;
  setQuery: (value: string) => void;
  /** Debounced + min-length-gated query the source is actually running. */
  effectiveQuery: string;
  status: SearchStatus;
  error: Error | null;
  /** Score-ordered results straight from the source. */
  results: SearchResult[];
  /** Grouped results with DOM-order `visualIndex` per item. */
  groups: ResultGroup[];
  /** Flat results in visual/DOM order — what keyboard nav indexes into. */
  visualResults: SearchResult[];
  /** Highlight terms. */
  terms: string[];
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  select: (result: SearchResult) => void;
  recents: RecentSearch[];
  pickRecent: (recent: RecentSearch) => void;
  removeRecent: (query: string) => void;
  clearRecents: () => void;
  canLoadMore: boolean;
  isLoadingMore: boolean;
  loadMore?: () => void;
  // Derived view flags ------------------------------------------------------
  isShortQuery: boolean;
  showEmptyState: boolean;
  showSkeleton: boolean;
  showNoResults: boolean;
  showError: boolean;
  showResults: boolean;
}

/**
 * Headless controller for the search command palette. Owns query state,
 * debounce, min-length gating, the call into the pluggable {@link SearchSource},
 * keyboard-nav visual order, recents and the derived view flags. The
 * presentational dialog renders from what this returns; the keyboard handler
 * (which needs the row refs for scroll-into-view) stays in the dialog.
 */
export function useSearchCommand({
  source,
  open,
  minQueryLength = 2,
  debounceMs = 250,
  getGroupKey,
  getGroupLabel,
  recentsStorageKey,
  onSelect,
}: UseSearchCommandOptions): SearchCommandController {
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, debounceMs);

  // View gating is driven by the RAW query so feedback is instant (the
  // "keep typing" hint appears on the first keystroke, not after the debounce).
  const rawTrimmed = query.trim();
  const meetsMin = rawTrimmed.length >= minQueryLength;

  // The source, however, runs on the DEBOUNCED query so we don't fire a query
  // per keystroke.
  const debouncedTrimmed = debounced.trim();
  const effectiveQuery =
    debouncedTrimmed.length >= minQueryLength ? debouncedTrimmed : '';

  // Rules of hooks: call the source unconditionally, every render. It receives
  // `active` so it can unsubscribe / skip work while the dialog is closed OR
  // the raw query is below min length — gating on `meetsMin` (raw, not
  // debounced) cancels the source the instant the user deletes back below the
  // threshold, instead of letting it keep running the stale debounced query
  // whose results would be discarded anyway.
  const sourceState = source(effectiveQuery, { active: open && meetsMin });

  // While a valid query is still settling through the debounce, the source is
  // running the previous (or empty) query — surface that as `loading` so we
  // show a skeleton/stale results rather than flashing the recents panel.
  const awaitingDebounce = meetsMin && effectiveQuery !== rawTrimmed;

  // Below the min length we never show source output — force idle/empty so the
  // empty state (recents + tips) renders instead of stale matches. Memoised so
  // the empty-case `[]` keeps a stable identity across renders.
  const results = useMemo(
    () => (meetsMin ? sourceState.results : EMPTY_RESULTS),
    [meetsMin, sourceState.results],
  );
  const status: SearchStatus = !meetsMin
    ? 'idle'
    : awaitingDebounce
      ? 'loading'
      : sourceState.status;
  const error = sourceState.error ?? null;

  const terms = useMemo(() => {
    const fromSource = sourceState.terms;
    if (fromSource && fromSource.length > 0) return fromSource;
    return extractTerms(debouncedTrimmed);
  }, [sourceState.terms, debouncedTrimmed]);

  const groups = useMemo(
    () => groupResults(results, getGroupKey, getGroupLabel),
    [results, getGroupKey, getGroupLabel],
  );
  const visualResults = useMemo(() => flattenGroups(groups), [groups]);

  const [activeIndex, setActiveIndex] = useState(0);
  const [recents, setRecents] = useState<RecentSearch[]>([]);

  // Hydrate recents whenever the dialog opens.
  useEffect(() => {
    if (!open || !recentsStorageKey) return;
    setRecents(loadRecentSearches(recentsStorageKey));
  }, [open, recentsStorageKey]);

  // Reset to a clean slate on close.
  useEffect(() => {
    if (!open) {
      setQuery('');
      setActiveIndex(0);
    }
  }, [open]);

  // Reset the active row whenever the *query* changes (not on every results
  // identity change — `loadMore` appends and must keep the active row put,
  // and a fresh array each render must not steal the selection).
  useEffect(() => {
    setActiveIndex(0);
  }, [effectiveQuery]);

  const select = useCallback(
    (result: SearchResult) => {
      if (recentsStorageKey) {
        setRecents(
          saveRecentSearch(recentsStorageKey, {
            query: query.trim() || result.title,
            href: result.href,
            title: result.title,
          }),
        );
      }
      onSelect(result);
    },
    [query, recentsStorageKey, onSelect],
  );

  const pickRecent = useCallback((recent: RecentSearch) => {
    setQuery(recent.query);
  }, []);

  const removeRecent = useCallback(
    (q: string) => {
      if (recentsStorageKey)
        setRecents(removeRecentSearch(recentsStorageKey, q));
    },
    [recentsStorageKey],
  );

  const clearRecents = useCallback(() => {
    if (!recentsStorageKey) return;
    clearRecentSearches(recentsStorageKey);
    setRecents([]);
  }, [recentsStorageKey]);

  // Derived view flags — single source of truth for what the body renders.
  const isShortQuery = rawTrimmed.length > 0 && !meetsMin;
  const showResults = meetsMin && status !== 'idle';
  const showEmptyState = !showResults;
  const showNoResults =
    showResults && status === 'ready' && results.length === 0;
  // Surface a source error instead of a blank list — but only when there are no
  // stale results worth keeping on screen (a transient error mid-typing
  // shouldn't wipe the last good page).
  const showError = showResults && status === 'error' && results.length === 0;
  // Skeleton only when loading AND there's nothing stale to keep visible —
  // otherwise we keep the previous results on screen so the list doesn't
  // blink between keystrokes.
  const showSkeleton =
    showResults && status === 'loading' && results.length === 0;

  return {
    query,
    setQuery,
    effectiveQuery,
    status,
    error,
    results,
    groups,
    visualResults,
    terms,
    activeIndex,
    setActiveIndex,
    select,
    recents,
    pickRecent,
    removeRecent,
    clearRecents,
    canLoadMore: sourceState.canLoadMore ?? false,
    isLoadingMore: sourceState.isLoadingMore ?? false,
    loadMore: sourceState.loadMore,
    isShortQuery,
    showEmptyState,
    showSkeleton,
    showNoResults,
    showError,
    showResults,
  };
}

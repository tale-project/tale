import type { ComponentType } from 'react';

/** Lifecycle of a single search invocation. Mirrors the docs search state
 *  machine so every surface renders skeleton/ready/error identically. */
export type SearchStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Normalised result shape — a superset that covers both the docs MiniSearch
 * pipeline (body/matchedTerms/match/score) AND platform entity rows
 * (subtitle/icon/href/group/data). All rich fields are optional so a simple
 * source only sets `id` + `title`.
 */
export interface SearchResult<TData = object> {
  /** Stable unique id within a result set (doc slug, thread id, customer id). */
  id: string;
  /** Primary line. */
  title: string;
  /** Secondary line under the title (a chat preview, an entity subtitle).
   *  Ignored when `body` is present — `body` drives a highlighted snippet. */
  subtitle?: string;
  /** Group key — section for docs, date-bucket for threads, entity type for
   *  mixed lists. Falls back to a single "Results" group when omitted. */
  group?: string;
  /** Navigation target. A string href, or omit it and resolve the target
   *  from `data`/`id` inside the caller's `onSelect` (platform uses router
   *  params, not URLs). */
  href?: string;
  /** Leading icon override. Falls back to the source/result-kind default. */
  icon?: ComponentType<{ className?: string }>;
  // --- rich docs-style fields, all optional ---------------------------------
  /** Raw body text — used to extract + highlight a snippet (docs). */
  body?: string;
  /** Index terms that matched, for highlight (docs rerank output). */
  matchedTerms?: string[];
  /** User tokens that fired (docs). */
  queryTerms?: string[];
  /** matched-field map → drives the docs row icon (title/heading/body). */
  match?: Record<string, string[]>;
  /** Final rerank score (docs). */
  score?: number;
  /** The original source row, carried through to the caller's `onSelect`.
   *  Defaults to `object` so simple sources can omit the type argument;
   *  parameterise `SearchResult<MyRow>` to get a typed payload end-to-end. */
  data?: TData;
}

/**
 * State a {@link SearchSource} returns each render. `loadMore`/`canLoadMore`
 * are omitted by sources that can't paginate (e.g. the static docs index).
 */
export interface SearchSourceState<TData = object> {
  results: SearchResult<TData>[];
  status: SearchStatus;
  error?: Error | null;
  /** Highlight terms (docs supplies tokenised query terms; others may omit —
   *  the controller falls back to tokenising the query). */
  terms?: string[];
  canLoadMore?: boolean;
  isLoadingMore?: boolean;
  loadMore?: () => void;
}

export interface SearchSourceContext {
  /** Whether the command is open. Sources should skip work / unsubscribe
   *  (e.g. pass Convex `'skip'`) when inactive. */
  active: boolean;
}

/**
 * A search data source — a React **hook**. The command calls it once,
 * unconditionally, every render with the live (debounced, min-length-gated)
 * query.
 *
 * Contract:
 * - Must obey the rules of hooks: a given mounted command always receives the
 *   same source identity (memoise adapters with `useMemo` / module scope) so
 *   its internal hooks run in a stable order.
 * - `results` SHOULD be referentially stable across renders when unchanged
 *   (memoise the mapping) — the controller keys keyboard-nav resets off the
 *   query, but stable arrays avoid needless re-grouping.
 */
export type SearchSource<TData = object> = (
  query: string,
  ctx: SearchSourceContext,
) => SearchSourceState<TData>;

export interface RecentSearch {
  /** Free-text query the user typed. */
  query: string;
  /** Optional target of the result the user opened (metadata only). */
  href?: string;
  /** Optional title of the result the user opened. */
  title?: string;
  /** Epoch milliseconds — used for ordering and TTL. */
  savedAt: number;
}

/** Every visible string in the command. Pass a `Partial` to override only
 *  what differs from {@link DEFAULT_LABELS}; each service owns its copy. */
export interface SearchCommandLabels {
  title: string;
  placeholder: string;
  empty: string;
  emptyHint: string;
  keepTyping: string;
  noResultsTitle: string;
  noResultsHint: string;
  /** Title shown when the source reports an error. */
  errorTitle: string;
  /** Secondary line under the error title. */
  errorHint: string;
  /** Header for the catch-all group when a result has no `group`. */
  resultsGroup: string;
  loading: string;
  close: string;
  recent: string;
  clearRecent: string;
  removeRecent: string;
  tipsTitle: string;
  tipNavigate: string;
  tipSelect: string;
  tipClose: string;
  resultCount: (count: number) => string;
}

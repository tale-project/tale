export { SearchCommand } from './search-command';
export type { SearchCommandProps } from './search-command';
export { useSearchCommand } from './use-search-command';
export type {
  SearchCommandController,
  UseSearchCommandOptions,
} from './use-search-command';
export { useSearchCommandLabels } from './use-search-command-labels';

// Building blocks — reusable outside the dialog (e.g. inline table search).
export { SearchResultRow } from './search-result-row';
export type {
  BreadcrumbResolver,
  ResultIconResolver,
} from './search-result-row';
export { SearchResultList } from './search-result-list';
export type { RenderResultArgs } from './search-result-list';
export { SearchSkeleton } from './search-skeleton';
export { SearchEmpty } from './search-empty';
export { SearchFooter } from './search-footer';
export { Highlight } from './highlight';
export { extractSnippet, extractTerms } from './snippet';
export {
  flattenGroups,
  FALLBACK_GROUP,
  groupResults,
  humanizeGroupKey,
  urlToBreadcrumb,
} from './group-by';
export type { ResultGroup, ResultGroupItem } from './group-by';
export {
  clearRecentSearches,
  loadRecentSearches,
  removeRecentSearch,
  saveRecentSearch,
} from './recent-searches';

export type {
  RecentSearch,
  SearchCommandLabels,
  SearchResult,
  SearchSource,
  SearchSourceContext,
  SearchSourceState,
  SearchStatus,
} from './types';

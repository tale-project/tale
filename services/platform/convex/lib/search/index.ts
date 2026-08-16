export type { SearchEngine, SearchStrategy } from './types';
export {
  type EntitySearchArgs,
  type IndexRangeBuilder,
  MAX_SEARCH_PAGE_SIZE,
  scopedSubstringSearch,
} from './scoped_substring_search';
export { runEntitySearch } from './run_entity_search';
export {
  isActiveRow,
  type MatchMode,
  queryTokens,
  rowMatches,
  scoreAndSort,
} from './relevance';

// Per-entity strategies.
export { contactsSearchStrategy } from './strategies/contacts';
export { documentsSearchStrategy } from './strategies/documents';
export { projectsSearchStrategy } from './strategies/projects';
export { tasksSearchStrategy } from './strategies/tasks';

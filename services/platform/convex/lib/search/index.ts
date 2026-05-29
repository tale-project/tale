export type { SearchEngine, SearchStrategy } from './types';
export {
  type EntitySearchArgs,
  type IndexRangeBuilder,
  MAX_SEARCH_PAGE_SIZE,
  scopedSubstringSearch,
} from './scoped_substring_search';
export { runEntitySearch } from './run_entity_search';
export { isActiveRow, rowMatches, scoreAndSort } from './relevance';

// Per-entity strategies.
export { customersSearchStrategy } from './strategies/customers';

import type { Doc, TableNames } from '../rows';

/**
 * Per-entity descriptor for the pure matcher (`rowMatches`): which fields of
 * a row a search term is held against. The single place that knows how a
 * table is searched — the 0.5 legs (`domains/conversations/search-chat.ts`)
 * fetch candidate rows in SQL and hand each one to the matcher with the
 * table's strategy.
 */
export interface SearchStrategy<T extends TableNames> {
  table: T;
  /** Text fields matched (case-insensitive substring), in relevance priority. */
  textFields: ReadonlyArray<keyof Doc<T>>;
  /** Array-of-string fields (e.g. `tags`) matched with `.some(includes)`. */
  arrayTextFields?: ReadonlyArray<keyof Doc<T>>;
  /** Id-like fields matched exactly (e.g. `externalId`). Coerced via `String`. */
  idFields?: ReadonlyArray<keyof Doc<T>>;
}

import type { Doc, TableNames } from '../../_generated/dataModel';

/**
 * Which engine resolves a strategy. `'scan'` is the org-scoped index scan +
 * substring match used today (Convex full-text `searchIndex` is disabled — see
 * `TODO(search-index-disabled)`). `'searchIndex'` is the future path: flip a
 * strategy's `engine` (and fill `searchIndexName`/`searchIndexField`) and the
 * dispatcher routes through `.withSearchIndex()` with zero call-site changes.
 */
export type SearchEngine = 'scan' | 'searchIndex';

/**
 * Per-entity descriptor consumed by {@link runEntitySearch}. The single place
 * that knows how a table is searched — call sites never branch on engine.
 */
export interface SearchStrategy<T extends TableNames> {
  table: T;
  /** Org-scoped base index used by the scan engine (e.g. `by_organizationId`). */
  orgIndex: string;
  /** Text fields matched (case-insensitive substring), in relevance priority. */
  textFields: ReadonlyArray<keyof Doc<T> & string>;
  /** Array-of-string fields (e.g. `tags`) matched with `.some(includes)`. */
  arrayTextFields?: ReadonlyArray<keyof Doc<T> & string>;
  /** Id-like fields matched exactly (e.g. `externalId`). Coerced via `String`. */
  idFields?: ReadonlyArray<keyof Doc<T> & string>;
  /** Drop soft-deleted rows (`lifecycleStatus !== 'active'`) when the table
   *  carries the field. */
  activeOnly?: boolean;
  /** Active engine. `'scan'` today; flip to `'searchIndex'` once the
   *  self-hosted bootstrap is fixed. */
  engine: SearchEngine;
  /** Future: name of the `.searchIndex()` to use when `engine === 'searchIndex'`. */
  searchIndexName?: string;
  /** Future: the search index's `searchField`. */
  searchIndexField?: string;
}
